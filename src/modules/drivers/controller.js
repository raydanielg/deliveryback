import prisma from "../../prisma/client.js"
import { z } from "zod"
import { logAction } from "../../middleware/audit-logger.js"

const createDriverSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string(),
  password: z.string().min(8),
  licenseNumber: z.string(),
  licenseClass: z.string().optional(),
  licenseIssueDate: z.string().datetime().optional(),
  licenseExpiry: z.string().datetime().optional(),
  employmentType: z.string().optional(),
  carrierId: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
})

const updateDriverSchema = z.object({
  licenseClass: z.string().optional(),
  licenseIssueDate: z.string().datetime().optional(),
  licenseExpiry: z.string().datetime().optional(),
  employmentType: z.string().optional(),
  carrierId: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  internalNotes: z.string().optional(),
})

const documentSchema = z.object({
  type: z.enum(["LICENSE", "IDENTIFICATION", "MEDICAL", "AUTHORIZATION", "OTHER"]),
  documentNumber: z.string().optional(),
  issueDate: z.string().datetime().optional(),
  expiryDate: z.string().datetime().optional(),
  fileUrl: z.string().optional(),
})

// A stored `status` on a document can drift out of date the moment its expiryDate passes —
// this recomputes it fresh on every read instead, exactly like the vehicle compliance report.
function documentDisplayStatus(doc) {
  if (doc.status === "REJECTED") return "REJECTED"
  if (!doc.expiryDate) return doc.status === "VALID" ? "VALID" : "PENDING_VERIFICATION"
  const now = new Date()
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  if (doc.expiryDate < now) return "EXPIRED"
  if (doc.expiryDate < soon) return "EXPIRING_SOON"
  return doc.status === "PENDING_VERIFICATION" ? "PENDING_VERIFICATION" : "VALID"
}

function withComputedDocs(driver) {
  if (!driver.documents) return driver
  return { ...driver, documents: driver.documents.map((d) => ({ ...d, computedStatus: documentDisplayStatus(d) })) }
}

// Sensitive fields (internalNotes, emergencyContact*, full document list) are only included
// for roles authorized to manage drivers — everyone else sees the operational subset.
function scopeDriverFields(driver, canViewSensitive) {
  if (canViewSensitive) return driver
  const { internalNotes, emergencyContactName, emergencyContactPhone, documents, ...rest } = driver
  return rest
}

const SENSITIVE_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"]

export async function listDrivers(req, res, next) {
  try {
    const drivers = await prisma.driver.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
        carrier: true,
        documents: true,
      },
      orderBy: { createdAt: "desc" },
    })
    const canViewSensitive = SENSITIVE_ROLES.includes(req.user?.role)
    res.json({ success: true, data: drivers.map((d) => scopeDriverFields(withComputedDocs(d), canViewSensitive)) })
  } catch (err) { next(err) }
}

export async function getDriver(req, res, next) {
  try {
    const driver = await prisma.driver.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
        carrier: true,
        documents: true,
      },
    })
    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" })
    const canViewSensitive = SENSITIVE_ROLES.includes(req.user?.role) || req.user?.id === driver.userId
    res.json({ success: true, data: scopeDriverFields(withComputedDocs(driver), canViewSensitive) })
  } catch (err) { next(err) }
}

export async function createDriver(req, res, next) {
  try {
    const data = createDriverSchema.parse(req.body)
    const bcrypt = await import("bcryptjs")
    const hashedPassword = await bcrypt.hash(data.password, 12)

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        password: hashedPassword,
        role: "DRIVER",
        isVerified: true,
      },
    })

    const driver = await prisma.driver.create({
      data: {
        userId: user.id,
        licenseNumber: data.licenseNumber,
        licenseClass: data.licenseClass,
        licenseIssueDate: data.licenseIssueDate ? new Date(data.licenseIssueDate) : null,
        licenseExpiry: data.licenseExpiry ? new Date(data.licenseExpiry) : null,
        employmentType: data.employmentType,
        carrierId: data.carrierId || null,
        emergencyContactName: data.emergencyContactName,
        emergencyContactPhone: data.emergencyContactPhone,
        approvalStatus: "PENDING_VERIFICATION",
      },
      include: { user: { select: { name: true, email: true, phone: true } } },
    })

    await logAction({ userId: req.user?.id, action: "DRIVER_CREATED", entity: "driver", entityId: driver.id, req })

    res.status(201).json({ success: true, data: driver, message: "Driver created — pending document verification before they can be assigned" })
  } catch (err) { next(err) }
}

export async function updateDriver(req, res, next) {
  try {
    const data = updateDriverSchema.parse(req.body)
    const updateData = { ...data }
    if (data.licenseIssueDate) updateData.licenseIssueDate = new Date(data.licenseIssueDate)
    if (data.licenseExpiry) updateData.licenseExpiry = new Date(data.licenseExpiry)
    const driver = await prisma.driver.update({ where: { id: req.params.id }, data: updateData })
    res.json({ success: true, data: driver })
  } catch (err) { next(err) }
}

export async function updateDriverStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status } = req.body

    const driver = await prisma.driver.update({
      where: { id },
      data: { status },
    })
    res.json({ success: true, data: driver })
  } catch (err) { next(err) }
}

// Driver onboarding lifecycle (Part A): PENDING_VERIFICATION -> ACTIVE / REJECTED /
// SUSPENDED / INACTIVE. This is intentionally separate from the operational `status`
// field — a driver can be approvalStatus=ACTIVE and status=OFFLINE at the same time.
export async function updateDriverApproval(req, res, next) {
  try {
    const { id } = req.params
    const { approvalStatus, reason } = req.body
    if (!["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "REJECTED", "INACTIVE"].includes(approvalStatus)) {
      return res.status(400).json({ success: false, message: "Invalid approval status" })
    }

    const driver = await prisma.driver.update({
      where: { id },
      data: {
        approvalStatus,
        // A driver who's suspended/rejected/deactivated at the HR level can't stay
        // "available" for dispatch — force them offline so the two states never contradict.
        status: approvalStatus !== "ACTIVE" ? "OFFLINE" : undefined,
      },
    })

    await logAction({ userId: req.user?.id, action: "DRIVER_APPROVAL_CHANGED", entity: "driver", entityId: id, changes: { approvalStatus, reason }, req })

    res.json({ success: true, data: driver })
  } catch (err) { next(err) }
}

export async function listDriverDocuments(req, res, next) {
  try {
    const documents = await prisma.driverDocument.findMany({ where: { driverId: req.params.id }, orderBy: { createdAt: "desc" } })
    res.json({ success: true, data: documents.map((d) => ({ ...d, computedStatus: documentDisplayStatus(d) })) })
  } catch (err) { next(err) }
}

export async function addDriverDocument(req, res, next) {
  try {
    const { id: driverId } = req.params
    const data = documentSchema.parse(req.body)

    const driver = await prisma.driver.findUnique({ where: { id: driverId } })
    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" })

    const document = await prisma.driverDocument.create({
      data: {
        driverId,
        type: data.type,
        documentNumber: data.documentNumber,
        issueDate: data.issueDate ? new Date(data.issueDate) : null,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        fileUrl: data.fileUrl,
        status: "PENDING_VERIFICATION",
      },
    })

    res.status(201).json({ success: true, data: { ...document, computedStatus: documentDisplayStatus(document) } })
  } catch (err) { next(err) }
}

export async function verifyDriverDocument(req, res, next) {
  try {
    const { documentId } = req.params
    const { approved } = req.body

    const document = await prisma.driverDocument.update({
      where: { id: documentId },
      data: {
        status: approved ? "VALID" : "REJECTED",
        verifiedById: req.user?.id,
        verifiedAt: new Date(),
      },
    })

    await logAction({ userId: req.user?.id, action: approved ? "DRIVER_DOCUMENT_VERIFIED" : "DRIVER_DOCUMENT_REJECTED", entity: "driver_document", entityId: documentId, req })

    res.json({ success: true, data: { ...document, computedStatus: documentDisplayStatus(document) } })
  } catch (err) { next(err) }
}

// Real, computed compliance check — used both by the dispatcher UI (to explain *why* a
// driver can't be assigned, per Part A) and mirrors the same checks assignShipment enforces.
export async function getDriverCompliance(req, res, next) {
  try {
    const driver = await prisma.driver.findUnique({ where: { id: req.params.id }, include: { documents: true } })
    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" })

    const reasons = []
    if (!driver.isActive) reasons.push("Driver account is inactive")
    if (driver.approvalStatus !== "ACTIVE") reasons.push(`Driver approval status is ${driver.approvalStatus.replace(/_/g, " ").toLowerCase()}`)
    if (driver.status !== "AVAILABLE") reasons.push(`Driver is currently ${driver.status.replace(/_/g, " ").toLowerCase()}`)
    if (driver.licenseExpiry && driver.licenseExpiry < new Date()) reasons.push("Driving license has expired")
    for (const doc of driver.documents) {
      const status = documentDisplayStatus(doc)
      if (status === "EXPIRED") reasons.push(`${doc.type.replace(/_/g, " ").toLowerCase()} document has expired`)
    }

    res.json({ success: true, data: { eligibleForAssignment: reasons.length === 0, reasons } })
  } catch (err) { next(err) }
}

export async function fleetDriverComplianceReport(req, res, next) {
  try {
    const drivers = await prisma.driver.findMany({
      where: { isActive: true },
      include: { user: { select: { name: true } }, documents: true },
    })
    const now = new Date()
    const flagged = drivers
      .map((d) => {
        const expiredDocs = d.documents.filter((doc) => documentDisplayStatus(doc) === "EXPIRED")
        const licenseExpired = d.licenseExpiry && d.licenseExpiry < now
        return { id: d.id, name: d.user?.name, licenseExpired, expiredDocuments: expiredDocs.map((doc) => doc.type) }
      })
      .filter((d) => d.licenseExpired || d.expiredDocuments.length > 0)

    res.json({ success: true, data: { flaggedCount: flagged.length, flagged } })
  } catch (err) { next(err) }
}

export async function getDriverPerformance(req, res, next) {
  try {
    const { id } = req.params
    const [assigned, delivered, failed, cancelled, exceptions, claims] = await Promise.all([
      prisma.shipment.count({ where: { driverId: id } }),
      prisma.shipment.count({ where: { driverId: id, status: "DELIVERED" } }),
      prisma.shipment.count({ where: { driverId: id, status: "DELIVERY_FAILED" } }),
      prisma.shipment.count({ where: { driverId: id, status: "CANCELLED" } }),
      prisma.shipmentException.count({ where: { shipment: { driverId: id } } }),
      prisma.claim.count({ where: { shipment: { driverId: id } } }),
    ])

    const delivered_shipments = await prisma.shipment.findMany({
      where: { driverId: id, status: "DELIVERED", actualPickup: { not: null }, actualDelivery: { not: null } },
      select: { actualPickup: true, actualDelivery: true },
    })
    const avgDeliveryHours = delivered_shipments.length
      ? delivered_shipments.reduce((sum, s) => sum + (s.actualDelivery - s.actualPickup) / 3600000, 0) / delivered_shipments.length
      : null

    res.json({
      success: true,
      data: {
        assignedJobs: assigned,
        completedJobs: delivered,
        failedDeliveries: failed,
        cancelledJobs: cancelled,
        exceptions,
        claims,
        onTimeDeliveryRate: assigned > 0 ? Number(((delivered / assigned) * 100).toFixed(1)) : null,
        avgDeliveryTimeHours: avgDeliveryHours != null ? Number(avgDeliveryHours.toFixed(1)) : null,
      },
    })
  } catch (err) { next(err) }
}
