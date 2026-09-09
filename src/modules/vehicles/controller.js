import prisma from "../../prisma/client.js"
import { z } from "zod"
import { logAction } from "../../middleware/audit-logger.js"

const createVehicleSchema = z.object({
  carrierId: z.string(),
  registrationNo: z.string().min(3),
  type: z.enum(["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP", "TRUCK", "TRAILER", "CONTAINER"]),
  capacityKg: z.number().min(0),
  capacityM3: z.number().min(0).optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1990).optional(),
  fuelType: z.string().optional(),
  insuranceExpiry: z.string().datetime().optional(),
  roadLicenseExpiry: z.string().datetime().optional(),
  inspectionExpiry: z.string().datetime().optional(),
  fitnessExpiry: z.string().datetime().optional(),
})

const updateVehicleSchema = createVehicleSchema.partial()

const maintenanceSchema = z.object({
  serviceDate: z.string().datetime(),
  serviceType: z.string().min(2),
  mileage: z.number().int().min(0).optional(),
  cost: z.number().min(0).optional(),
  description: z.string().optional(),
  nextServiceDate: z.string().datetime().optional(),
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED"]).default("COMPLETED"),
})

const COMPLIANCE_FIELDS = ["insuranceExpiry", "roadLicenseExpiry", "inspectionExpiry", "fitnessExpiry"]
const EXPIRING_SOON_DAYS = 30

// Never trust a stored "is this compliant" flag that can silently go stale — recompute from
// the actual expiry dates on every read, the same way driver-document status is derived.
function complianceSummary(vehicle) {
  const now = new Date()
  const soonCutoff = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000)
  const items = COMPLIANCE_FIELDS.map((field) => {
    const value = vehicle[field]
    let status = "MISSING"
    if (value) {
      if (value < now) status = "EXPIRED"
      else if (value < soonCutoff) status = "EXPIRING_SOON"
      else status = "VALID"
    }
    return { field, expiry: value, status }
  })
  const overall = items.some((i) => i.status === "EXPIRED") ? "EXPIRED"
    : items.some((i) => i.status === "EXPIRING_SOON") ? "EXPIRING_SOON"
    : items.some((i) => i.status === "MISSING") ? "MISSING"
    : "VALID"
  return { overall, items }
}

export async function listVehicles(req, res, next) {
  try {
    const vehicles = await prisma.vehicle.findMany({
      include: { carrier: true, _count: { select: { maintenanceRecords: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: vehicles.map((v) => ({ ...v, compliance: complianceSummary(v) })) })
  } catch (err) { next(err) }
}

export async function getVehicle(req, res, next) {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: { carrier: true, maintenanceRecords: { orderBy: { serviceDate: "desc" } } },
    })
    if (!vehicle) return res.status(404).json({ success: false, message: "Vehicle not found" })
    res.json({ success: true, data: { ...vehicle, compliance: complianceSummary(vehicle) } })
  } catch (err) { next(err) }
}

function toDateFields(data) {
  const out = { ...data }
  for (const field of COMPLIANCE_FIELDS) {
    if (out[field] !== undefined) out[field] = out[field] ? new Date(out[field]) : null
  }
  return out
}

export async function createVehicle(req, res, next) {
  try {
    const data = createVehicleSchema.parse(req.body)
    const vehicle = await prisma.vehicle.create({ data: toDateFields(data) })
    res.status(201).json({ success: true, data: { ...vehicle, compliance: complianceSummary(vehicle) } })
  } catch (err) { next(err) }
}

export async function updateVehicle(req, res, next) {
  try {
    const data = updateVehicleSchema.parse(req.body)
    const vehicle = await prisma.vehicle.update({ where: { id: req.params.id }, data: toDateFields(data) })
    res.json({ success: true, data: { ...vehicle, compliance: complianceSummary(vehicle) } })
  } catch (err) { next(err) }
}

export async function updateVehicleStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status } = req.body
    const vehicle = await prisma.vehicle.update({ where: { id }, data: { status } })
    res.json({ success: true, data: vehicle })
  } catch (err) { next(err) }
}

export async function listMaintenanceRecords(req, res, next) {
  try {
    const records = await prisma.vehicleMaintenanceRecord.findMany({
      where: { vehicleId: req.params.id },
      orderBy: { serviceDate: "desc" },
    })
    res.json({ success: true, data: records })
  } catch (err) { next(err) }
}

export async function createMaintenanceRecord(req, res, next) {
  try {
    const { id: vehicleId } = req.params
    const data = maintenanceSchema.parse(req.body)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) return res.status(404).json({ success: false, message: "Vehicle not found" })

    const record = await prisma.$transaction(async (tx) => {
      const record = await tx.vehicleMaintenanceRecord.create({
        data: {
          vehicleId,
          serviceDate: new Date(data.serviceDate),
          serviceType: data.serviceType,
          mileage: data.mileage,
          cost: data.cost,
          description: data.description,
          nextServiceDate: data.nextServiceDate ? new Date(data.nextServiceDate) : null,
          status: data.status,
          createdById: req.user?.id,
        },
      })

      // A vehicle actively being serviced can't be dispatched — this is what keeps
      // "AVAILABLE" meaningful rather than a stale flag nobody updates.
      if (data.status === "IN_PROGRESS" || data.status === "SCHEDULED") {
        await tx.vehicle.update({ where: { id: vehicleId }, data: { status: "MAINTENANCE" } })
      } else if (data.status === "COMPLETED" && vehicle.status === "MAINTENANCE") {
        await tx.vehicle.update({ where: { id: vehicleId }, data: { status: "AVAILABLE" } })
      }

      return record
    })

    await logAction({ userId: req.user?.id, action: "VEHICLE_MAINTENANCE_LOGGED", entity: "vehicle", entityId: vehicleId, changes: { serviceType: data.serviceType, status: data.status }, req })

    res.status(201).json({ success: true, data: record })
  } catch (err) { next(err) }
}

export async function updateMaintenanceRecord(req, res, next) {
  try {
    const { recordId } = req.params
    const data = maintenanceSchema.partial().parse(req.body)

    const existing = await prisma.vehicleMaintenanceRecord.findUnique({ where: { id: recordId } })
    if (!existing) return res.status(404).json({ success: false, message: "Maintenance record not found" })

    const updateData = { ...data }
    if (data.serviceDate) updateData.serviceDate = new Date(data.serviceDate)
    if (data.nextServiceDate) updateData.nextServiceDate = new Date(data.nextServiceDate)

    const record = await prisma.$transaction(async (tx) => {
      const record = await tx.vehicleMaintenanceRecord.update({ where: { id: recordId }, data: updateData })
      if (data.status === "COMPLETED") {
        await tx.vehicle.update({ where: { id: existing.vehicleId }, data: { status: "AVAILABLE" } }).catch(() => {})
      }
      return record
    })

    res.json({ success: true, data: record })
  } catch (err) { next(err) }
}

export async function fleetComplianceReport(req, res, next) {
  try {
    const vehicles = await prisma.vehicle.findMany({ where: { isActive: true } })
    const withCompliance = vehicles.map((v) => ({ id: v.id, registrationNo: v.registrationNo, compliance: complianceSummary(v) }))
    res.json({
      success: true,
      data: {
        expired: withCompliance.filter((v) => v.compliance.overall === "EXPIRED"),
        expiringSoon: withCompliance.filter((v) => v.compliance.overall === "EXPIRING_SOON"),
        valid: withCompliance.filter((v) => v.compliance.overall === "VALID"),
      },
    })
  } catch (err) { next(err) }
}
