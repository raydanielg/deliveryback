import prisma from "../../prisma/client.js"
import { emitToShipment } from "../../realtime/socket.js"
import { logAction } from "../../middleware/audit-logger.js"
import { triggerStatusNotification } from "../notification-service/controller.js"
import { createDeliverySchema, completeDeliverySchema, failDeliverySchema, approveFeeSchema } from "./validation.js"

// XERIN Module 9 — Delivery Register.
// DEL-YYYY-MM-NNNN auto numbering. Drivers/vehicles come from the Driver/Vehicle
// tables (not free text — D13). A delivery cannot close without OTP or signature (D7).
// Failed deliveries return the parcel to the warehouse and the storage clock resumes.

async function generateDeliveryNo(tx = prisma) {
  const now = new Date()
  const prefix = `DEL-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-`
  const latest = await tx.deliveryRecord.findFirst({
    where: { deliveryNo: { startsWith: prefix } },
    orderBy: { deliveryNo: "desc" },
    select: { deliveryNo: true },
  })
  const seq = latest ? parseInt(latest.deliveryNo.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(seq).padStart(4, "0")}`
}

const RECORD_INCLUDE = {
  shipment: {
    select: {
      id: true, trackingNumber: true, status: true, deliveryOption: true,
      customer: { include: { user: { select: { name: true, phone: true } } } },
    },
  },
  driver: { include: { user: { select: { name: true, phone: true } } } },
  vehicle: { select: { id: true, registrationNo: true, type: true } },
  zone: { select: { id: true, name: true, feeAmount: true } },
  createdBy: { select: { id: true, name: true } },
  feeApprovedBy: { select: { id: true, name: true } },
}

export async function listDeliveries(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const { status, driverId, search } = req.query

    const where = {}
    if (status) where.status = status
    if (driverId) where.driverId = driverId
    if (search) {
      where.OR = [
        { deliveryNo: { contains: search, mode: "insensitive" } },
        { shipment: { trackingNumber: { contains: search, mode: "insensitive" } } },
        { shipment: { customer: { user: { name: { contains: search, mode: "insensitive" } } } } },
      ]
    }

    const [records, total] = await Promise.all([
      prisma.deliveryRecord.findMany({
        where, include: RECORD_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit, take: limit,
      }),
      prisma.deliveryRecord.count({ where }),
    ])

    res.json({ success: true, data: records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

// Driver's own run sheet for today (spec screen 10.7).
export async function myDeliveries(req, res, next) {
  try {
    const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } })
    if (!driver) return res.status(403).json({ success: false, message: "No driver profile linked to this account" })

    const records = await prisma.deliveryRecord.findMany({
      where: { driverId: driver.id, status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY"] } },
      include: RECORD_INCLUDE,
      orderBy: { createdAt: "asc" },
    })
    res.json({ success: true, data: records })
  } catch (err) { next(err) }
}

export async function getDelivery(req, res, next) {
  try {
    const record = await prisma.deliveryRecord.findUnique({ where: { id: req.params.id }, include: RECORD_INCLUDE })
    if (!record) return res.status(404).json({ success: false, message: "Delivery record not found" })
    res.json({ success: true, data: record })
  } catch (err) { next(err) }
}

export async function createDelivery(req, res, next) {
  try {
    const data = createDeliverySchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({
      where: { id: data.shipmentId },
      include: { deliveryZone: true },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    // R6/§8.4 — nothing leaves the warehouse without an APPROVED payment approval.
    const approval = await prisma.paymentApproval.findFirst({
      where: { shipmentId: shipment.id, approvalStatus: "APPROVED" },
      orderBy: { createdAt: "desc" },
    })
    if (!approval) {
      return res.status(400).json({ success: false, message: "Payment approval required before this shipment can go out for delivery" })
    }
    if (shipment.condition === "SUSPICIOUS") {
      return res.status(400).json({ success: false, message: "Shipment is flagged SUSPICIOUS — manager clearance required before release" })
    }

    const driver = await prisma.driver.findUnique({ where: { id: data.driverId }, include: { user: { select: { name: true } } } })
    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" })
    if (data.vehicleId) {
      const vehicle = await prisma.vehicle.findUnique({ where: { id: data.vehicleId } })
      if (!vehicle) return res.status(404).json({ success: false, message: "Vehicle not found" })
    }

    const zoneId = data.zoneId || shipment.deliveryZoneId
    const zone = zoneId ? await prisma.deliveryZone.findUnique({ where: { id: zoneId } }) : null
    const zoneFee = zone ? Number(zone.feeAmount) : 0
    const requestedFee = data.deliveryFee ?? zoneFee

    // §2.2 — a fee different from the zone rate needs a reason and stays pending
    // manager approval (feeApprovedById set by approveFee).
    const isOverride = requestedFee !== zoneFee
    if (isOverride && !data.feeOverrideReason) {
      return res.status(400).json({ success: false, message: `Fee ${requestedFee} differs from zone rate ${zoneFee} — an override reason is required` })
    }

    const attempt = (await prisma.deliveryRecord.count({ where: { shipmentId: shipment.id } })) + 1

    const record = await prisma.$transaction(async (tx) => {
      const rec = await tx.deliveryRecord.create({
        data: {
          deliveryNo: await generateDeliveryNo(tx),
          shipmentId: shipment.id,
          driverId: driver.id,
          vehicleId: data.vehicleId || null,
          zoneId: zone?.id || null,
          deliveryFee: requestedFee,
          feeOverrideReason: isOverride ? data.feeOverrideReason : null,
          address: data.address,
          attempt,
          createdById: req.user.id,
        },
        include: RECORD_INCLUDE,
      })
      await tx.shipment.update({
        where: { id: shipment.id },
        data: { delNumber: rec.deliveryNo, driverId: driver.id, vehicleId: data.vehicleId || null, lastMovementAt: new Date() },
      })
      return rec
    })

    await logAction({
      userId: req.user.id, action: "CREATE_DELIVERY", entity: "DeliveryRecord", entityId: record.id,
      changes: { deliveryNo: record.deliveryNo, shipmentId: shipment.id, driverId: driver.id, fee: requestedFee, override: isOverride }, req,
    })

    res.status(201).json({ success: true, data: record, message: `Delivery ${record.deliveryNo} assigned to ${driver.user?.name}` })
  } catch (err) { next(err) }
}

// Dispatch hands the parcel to the driver — register must be filled before departure (R7).
export async function markOutForDelivery(req, res, next) {
  try {
    const record = await prisma.deliveryRecord.findUnique({ where: { id: req.params.id }, include: { shipment: true } })
    if (!record) return res.status(404).json({ success: false, message: "Delivery record not found" })
    if (record.status !== "ASSIGNED") {
      return res.status(400).json({ success: false, message: `Delivery is ${record.status}, not ASSIGNED` })
    }
    if (record.feeOverrideReason && !record.feeApprovedById) {
      return res.status(400).json({ success: false, message: "This delivery has a fee override awaiting manager approval" })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const rec = await tx.deliveryRecord.update({
        where: { id: record.id },
        data: { status: "OUT_FOR_DELIVERY", releasedAt: new Date() },
        include: RECORD_INCLUDE,
      })
      await tx.shipment.update({
        where: { id: record.shipmentId },
        data: { status: "OUT_FOR_DELIVERY", releaseDate: new Date(), lastMovementAt: new Date() },
      })
      await tx.trackingEvent.create({
        data: {
          shipmentId: record.shipmentId, event: "OUT_FOR_DELIVERY", status: "OUT_FOR_DELIVERY",
          description: `Out for delivery on ${record.deliveryNo} (attempt ${record.attempt})`,
          createdBy: req.user.id,
        },
      })
      return rec
    })

    await triggerStatusNotification(record.shipmentId, "OUT_FOR_DELIVERY")
    emitToShipment(record.shipmentId, "shipment:status_changed", { shipmentId: record.shipmentId, status: "OUT_FOR_DELIVERY" })

    res.json({ success: true, data: updated, message: `${record.deliveryNo} is out for delivery` })
  } catch (err) { next(err) }
}

// Close a delivery — OTP or receiver signature is mandatory (D7, R7).
export async function completeDelivery(req, res, next) {
  try {
    const data = completeDeliverySchema.parse(req.body)
    if (!data.receiverOtp && !data.receiverSignatureUrl) {
      return res.status(400).json({ success: false, message: "Customer OTP or signature is required to close a delivery" })
    }

    const record = await prisma.deliveryRecord.findUnique({ where: { id: req.params.id } })
    if (!record) return res.status(404).json({ success: false, message: "Delivery record not found" })
    if (record.status !== "OUT_FOR_DELIVERY") {
      return res.status(400).json({ success: false, message: `Delivery is ${record.status} — must be OUT_FOR_DELIVERY to complete` })
    }

    const deliveredAt = data.deliveredAt ? new Date(data.deliveredAt) : new Date()

    const updated = await prisma.$transaction(async (tx) => {
      const rec = await tx.deliveryRecord.update({
        where: { id: record.id },
        data: {
          status: "DELIVERED",
          receiverName: data.receiverName,
          receiverOtp: data.receiverOtp || null,
          receiverSignatureUrl: data.receiverSignatureUrl || null,
          driverSignatureUrl: data.driverSignatureUrl || null,
          deliveredAt,
        },
        include: RECORD_INCLUDE,
      })
      await tx.shipment.update({
        where: { id: record.shipmentId },
        data: { status: "DELIVERED", actualDelivery: deliveredAt, lastMovementAt: new Date() },
      })
      await tx.trackingEvent.create({
        data: {
          shipmentId: record.shipmentId, event: "DELIVERED", status: "DELIVERED",
          description: `Delivered to ${data.receiverName} on ${record.deliveryNo}${data.receiverOtp ? " (OTP verified)" : " (signature captured)"}`,
          createdBy: req.user.id,
        },
      })
      return rec
    })

    await logAction({
      userId: req.user.id, action: "COMPLETE_DELIVERY", entity: "DeliveryRecord", entityId: record.id,
      changes: { deliveryNo: record.deliveryNo, receiver: data.receiverName, proof: data.receiverOtp ? "OTP" : "SIGNATURE" }, req,
    })
    await triggerStatusNotification(record.shipmentId, "DELIVERED")
    emitToShipment(record.shipmentId, "shipment:status_changed", { shipmentId: record.shipmentId, status: "DELIVERED" })

    res.json({ success: true, data: updated, message: `${record.deliveryNo} delivered to ${data.receiverName}` })
  } catch (err) { next(err) }
}

// Failed attempt — reason mandatory; parcel returns to warehouse and storage resumes (§Module 9).
export async function failDelivery(req, res, next) {
  try {
    const data = failDeliverySchema.parse(req.body)

    const record = await prisma.deliveryRecord.findUnique({ where: { id: req.params.id } })
    if (!record) return res.status(404).json({ success: false, message: "Delivery record not found" })
    if (!["OUT_FOR_DELIVERY", "ASSIGNED"].includes(record.status)) {
      return res.status(400).json({ success: false, message: `Delivery is ${record.status} — cannot mark failed` })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const rec = await tx.deliveryRecord.update({
        where: { id: record.id },
        data: { status: "FAILED_DELIVERY", failureReason: data.reason },
        include: RECORD_INCLUDE,
      })
      // Parcel goes back on the shelf — storage clock resumes from return (§8.1).
      await tx.shipment.update({
        where: { id: record.shipmentId },
        data: { status: "ON_SHELF", storageStartAt: new Date(), releaseDate: null, lastMovementAt: new Date() },
      })
      await tx.trackingEvent.create({
        data: {
          shipmentId: record.shipmentId, event: "DELIVERY_FAILED", status: "ON_SHELF",
          description: `Delivery attempt ${record.attempt} failed on ${record.deliveryNo}: ${data.reason}. Returned to warehouse — storage resumes.`,
          createdBy: req.user.id,
        },
      })
      return rec
    })

    await logAction({
      userId: req.user.id, action: "FAIL_DELIVERY", entity: "DeliveryRecord", entityId: record.id,
      changes: { deliveryNo: record.deliveryNo, attempt: record.attempt, reason: data.reason }, req,
    })
    emitToShipment(record.shipmentId, "shipment:status_changed", { shipmentId: record.shipmentId, status: "ON_SHELF" })

    res.json({ success: true, data: updated, message: `Attempt ${record.attempt} failed — parcel returned to warehouse` })
  } catch (err) { next(err) }
}

// Manager approves/rejects a non-standard delivery fee (§2.2 — Special Quote).
export async function approveFeeOverride(req, res, next) {
  try {
    const data = approveFeeSchema.parse(req.body)

    const record = await prisma.deliveryRecord.findUnique({ where: { id: req.params.id }, include: { zone: true } })
    if (!record) return res.status(404).json({ success: false, message: "Delivery record not found" })
    if (!record.feeOverrideReason) {
      return res.status(400).json({ success: false, message: "This delivery has no fee override to approve" })
    }
    if (record.feeApprovedById) {
      return res.status(400).json({ success: false, message: "Fee override already decided" })
    }

    const updated = await prisma.deliveryRecord.update({
      where: { id: record.id },
      data: data.approved
        ? { feeApprovedById: req.user.id }
        : { feeOverrideReason: null, deliveryFee: record.zone?.feeAmount ?? record.deliveryFee },
      include: RECORD_INCLUDE,
    })

    await logAction({
      userId: req.user.id, action: data.approved ? "APPROVE_FEE_OVERRIDE" : "REJECT_FEE_OVERRIDE",
      entity: "DeliveryRecord", entityId: record.id,
      changes: { deliveryNo: record.deliveryNo, fee: record.deliveryFee, reason: data.reason }, req,
    })

    res.json({ success: true, data: updated, message: data.approved ? "Fee override approved" : "Fee override rejected — zone rate restored" })
  } catch (err) { next(err) }
}
