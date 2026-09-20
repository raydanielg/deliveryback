import { z } from "zod"
import prisma from "../../prisma/client.js"
import { logAction } from "../../middleware/audit-logger.js"
import { estimateOptions, LogisticsError } from "./service.js"

const SERVICE_LEVELS = ["STANDARD", "EXPRESS", "SAME_DAY", "NEXT_DAY", "ECONOMY", "PRIORITY"]
const MODES = ["ROAD", "AIR", "SEA", "COURIER", "RAIL"]

const placeSchema = z.object({
  city: z.string().min(1).optional(),
  country: z.string().optional(),
  airportIata: z.string().length(3).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).refine((p) => p.city || p.airportIata, { message: "city or airportIata is required" })

const estimateSchema = z.object({
  origin: placeSchema,
  destination: placeSchema,
  weightKg: z.number().min(0.01),
  lengthCm: z.number().min(0).optional(),
  widthCm: z.number().min(0).optional(),
  heightCm: z.number().min(0).optional(),
  serviceLevel: z.enum(SERVICE_LEVELS).default("STANDARD"),
  modes: z.array(z.enum(MODES)).optional(),
})

function handle(err, res, next) {
  if (err instanceof LogisticsError) return res.status(err.status).json({ success: false, message: err.message })
  return next(err)
}

// ---------- public: what a customer sees while choosing how to ship ----------

export async function listVehicleClasses(req, res, next) {
  try {
    const all = req.query.all === "1" && req.user && ["SUPER_ADMIN", "OPERATIONS_MANAGER"].includes(req.user.role)
    const data = await prisma.vehicleClass.findMany({ where: all ? {} : { isActive: true }, orderBy: [{ mode: "asc" }, { sortOrder: "asc" }] })
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export async function searchDestinations(req, res, next) {
  try {
    const q = String(req.query.q || "").trim()
    const admin = req.query.all === "1" && req.user && ["SUPER_ADMIN", "OPERATIONS_MANAGER"].includes(req.user.role)
    const where = {
      ...(admin ? {} : { isActive: true }),
      ...(req.query.regionId ? { regionId: String(req.query.regionId) } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { region: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    }
    const data = await prisma.city.findMany({
      where,
      include: { region: { select: { id: true, name: true, isBlocked: true } }, country: { select: { name: true, code: true } } },
      orderBy: [{ kind: "desc" }, { name: "asc" }],
      take: Math.min(parseInt(req.query.limit) || 200, 500),
    })
    // Blocked places stay visible (customers see why) but are flagged so apps can grey them out.
    res.json({ success: true, data: data.map((c) => ({ ...c, bookable: c.isActive && !c.isBlocked && !c.region?.isBlocked })) })
  } catch (err) { next(err) }
}

export async function listRegions(req, res, next) {
  try {
    const admin = req.user && ["SUPER_ADMIN", "OPERATIONS_MANAGER"].includes(req.user.role)
    const data = await prisma.region.findMany({
      where: admin && req.query.all === "1" ? {} : { isActive: true },
      include: { _count: { select: { cities: true } } },
      orderBy: { name: "asc" },
    })
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export async function searchAirports(req, res, next) {
  try {
    const q = String(req.query.q || "").trim()
    const admin = req.query.all === "1" && req.user && ["SUPER_ADMIN", "OPERATIONS_MANAGER"].includes(req.user.role)
    const data = await prisma.airport.findMany({
      where: {
        ...(admin ? {} : { isActive: true }),
        ...(req.query.scope ? { scope: String(req.query.scope) } : {}),
        ...(req.query.country ? { countryCode: String(req.query.country).toUpperCase() } : {}),
        ...(q ? { OR: [{ iata: { equals: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { countryName: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: [{ scope: "desc" }, { city: "asc" }],
      take: Math.min(parseInt(req.query.limit) || 100, 300),
    })
    res.json({ success: true, data: data.map((a) => ({ ...a, bookable: a.isActive && !a.isBlocked })) })
  } catch (err) { next(err) }
}

export async function estimate(req, res, next) {
  try {
    const d = estimateSchema.parse(req.body)
    const volumeM3 = d.lengthCm && d.widthCm && d.heightCm ? (d.lengthCm * d.widthCm * d.heightCm) / 1e6 : undefined
    // Volumetric weight (5000 cm³/kg) — the bulkier of actual vs volumetric is what is charged.
    const volumetricKg = volumeM3 ? (volumeM3 * 1e6) / 5000 : 0
    const result = await estimateOptions({
      origin: d.origin, destination: d.destination, weightKg: d.weightKg, volumeM3,
      chargeableKg: Math.max(d.weightKg, volumetricKg), serviceLevel: d.serviceLevel, modes: d.modes,
    })
    res.json({ success: true, data: result })
  } catch (err) { handle(err, res, next) }
}

// ---------- admin: Super Admin / Operations edit the catalog ----------

const vehicleClassSchema = z.object({
  code: z.string().min(2).max(30).regex(/^[A-Z0-9_]+$/, "Use capital letters, digits and _"),
  name: z.string().min(2),
  nameSw: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  mode: z.enum(MODES),
  vehicleType: z.enum(["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP", "TRUCK", "TRAILER", "CONTAINER"]).optional().nullable(),
  minWeightKg: z.number().min(0).default(0),
  maxWeightKg: z.number().positive(),
  maxVolumeM3: z.number().positive().optional().nullable(),
  baseFare: z.number().min(0).default(0),
  perKm: z.number().min(0).default(0),
  perKg: z.number().min(0).default(0),
  includedKg: z.number().min(0).default(0),
  minCharge: z.number().min(0).optional().nullable(),
  avgSpeedKmh: z.number().positive(),
  handlingHours: z.number().min(0).default(2),
  maxDriveHoursPerDay: z.number().min(1).max(24).default(10),
  maxDistanceKm: z.number().positive().optional().nullable(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
})

export async function createVehicleClass(req, res, next) {
  try {
    const data = vehicleClassSchema.parse(req.body)
    const row = await prisma.vehicleClass.create({ data })
    await logAction({ userId: req.user.id, action: "CREATE_VEHICLE_CLASS", entity: "VehicleClass", entityId: row.id, changes: { code: row.code }, req })
    res.status(201).json({ success: true, data: row })
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ success: false, message: "A class with that code already exists" })
    next(err)
  }
}

export async function updateVehicleClass(req, res, next) {
  try {
    const data = vehicleClassSchema.partial().parse(req.body)
    const row = await prisma.vehicleClass.update({ where: { id: req.params.id }, data })
    await logAction({ userId: req.user.id, action: "UPDATE_VEHICLE_CLASS", entity: "VehicleClass", entityId: row.id, changes: data, req })
    res.json({ success: true, data: row })
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ success: false, message: "Vehicle class not found" })
    next(err)
  }
}

export async function listServiceLevels(req, res, next) {
  try {
    res.json({ success: true, data: await prisma.serviceLevelConfig.findMany({ orderBy: { level: "asc" } }) })
  } catch (err) { next(err) }
}

export async function updateServiceLevel(req, res, next) {
  try {
    const level = z.enum(SERVICE_LEVELS).parse(req.params.level)
    const data = z.object({
      label: z.string().min(1).optional(),
      etaFactor: z.number().min(0.05).max(10).optional(),
      priceFactor: z.number().min(0.1).max(10).optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body)
    const row = await prisma.serviceLevelConfig.update({ where: { level }, data })
    await logAction({ userId: req.user.id, action: "UPDATE_SERVICE_LEVEL", entity: "ServiceLevelConfig", entityId: level, changes: data, req })
    res.json({ success: true, data: row })
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ success: false, message: "Service level not found" })
    next(err)
  }
}

const blockSchema = z.object({ isBlocked: z.boolean(), reason: z.string().max(300).optional() })
  .refine((b) => !b.isBlocked || !!b.reason?.trim(), { message: "Give a reason when blocking so customers can be told why" })

function blocker(model, entity) {
  return async (req, res, next) => {
    try {
      const b = blockSchema.parse(req.body)
      const row = await prisma[model].update({ where: { id: req.params.id }, data: { isBlocked: b.isBlocked, blockedReason: b.isBlocked ? b.reason.trim() : null } })
      await logAction({ userId: req.user.id, action: b.isBlocked ? `BLOCK_${entity.toUpperCase()}` : `UNBLOCK_${entity.toUpperCase()}`, entity, entityId: row.id, changes: b, req })
      res.json({ success: true, data: row })
    } catch (err) {
      if (err.code === "P2025") return res.status(404).json({ success: false, message: `${entity} not found` })
      next(err)
    }
  }
}
export const blockCity = blocker("city", "City")
export const blockRegion = blocker("region", "Region")
export const blockAirport = blocker("airport", "Airport")

const activeSchema = z.object({ isActive: z.boolean() })
function activator(model, entity) {
  return async (req, res, next) => {
    try {
      const { isActive } = activeSchema.parse(req.body)
      const row = await prisma[model].update({ where: { id: req.params.id }, data: { isActive } })
      await logAction({ userId: req.user.id, action: `${isActive ? "ENABLE" : "DISABLE"}_${entity.toUpperCase()}`, entity, entityId: row.id, changes: { isActive }, req })
      res.json({ success: true, data: row })
    } catch (err) {
      if (err.code === "P2025") return res.status(404).json({ success: false, message: `${entity} not found` })
      next(err)
    }
  }
}
export const setCityActive = activator("city", "City")
export const setAirportActive = activator("airport", "Airport")

export async function updateCity(req, res, next) {
  try {
    const data = z.object({
      name: z.string().min(2).optional(),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
      kind: z.enum(["REGIONAL_CAPITAL", "TOWN"]).optional(),
    }).parse(req.body)
    const row = await prisma.city.update({ where: { id: req.params.id }, data })
    await logAction({ userId: req.user.id, action: "UPDATE_CITY", entity: "City", entityId: row.id, changes: data, req })
    res.json({ success: true, data: row })
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ success: false, message: "City not found" })
    next(err)
  }
}

export async function createAirport(req, res, next) {
  try {
    const data = z.object({
      iata: z.string().length(3).transform((s) => s.toUpperCase()),
      name: z.string().min(2), city: z.string().min(2),
      countryCode: z.string().min(2).max(3).transform((s) => s.toUpperCase()), countryName: z.string().min(2),
      latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
      scope: z.enum(["TANZANIA", "EAST_AFRICA", "WORLD"]).default("WORLD"),
    }).parse(req.body)
    const row = await prisma.airport.create({ data })
    await logAction({ userId: req.user.id, action: "CREATE_AIRPORT", entity: "Airport", entityId: row.id, changes: { iata: row.iata }, req })
    res.status(201).json({ success: true, data: row })
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ success: false, message: "That IATA code already exists" })
    next(err)
  }
}
