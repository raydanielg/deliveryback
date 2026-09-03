import prisma from "../../prisma/client.js"
import { createZoneSchema } from "./validation.js"

export async function listZones(req, res, next) {
  try {
    const { activeOnly, countryId, regionId, cityId } = req.query
    const where = {}
    if (activeOnly === "true") where.isActive = true
    if (countryId) where.countryId = countryId
    if (regionId) where.regionId = regionId
    if (cityId) where.cityId = cityId

    const zones = await prisma.zone.findMany({
      where,
      include: {
        country: { select: { id: true, name: true, code: true } },
        region: { select: { id: true, name: true } },
        city: { select: { id: true, name: true } },
        _count: { select: { pricingRules: true } },
      },
      orderBy: { name: "asc" },
    })
    res.json({ success: true, data: zones })
  } catch (err) { next(err) }
}

export async function getZone(req, res, next) {
  try {
    const { id } = req.params
    const zone = await prisma.zone.findUnique({
      where: { id },
      include: {
        country: true,
        region: true,
        city: true,
        pricingRules: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    })
    if (!zone) return res.status(404).json({ success: false, message: "Zone not found" })
    res.json({ success: true, data: zone })
  } catch (err) { next(err) }
}

export async function createZone(req, res, next) {
  try {
    const data = createZoneSchema.parse(req.body)
    const zone = await prisma.zone.create({ data })
    res.status(201).json({ success: true, data: zone })
  } catch (err) { next(err) }
}

export async function updateZone(req, res, next) {
  try {
    const { id } = req.params
    const data = createZoneSchema.partial().parse(req.body)
    const zone = await prisma.zone.update({ where: { id }, data })
    res.json({ success: true, data: zone })
  } catch (err) { next(err) }
}

export async function deleteZone(req, res, next) {
  try {
    const { id } = req.params
    await prisma.zone.delete({ where: { id } })
    res.json({ success: true, message: "Zone deleted" })
  } catch (err) { next(err) }
}

export async function toggleZone(req, res, next) {
  try {
    const { id } = req.params
    const zone = await prisma.zone.findUnique({ where: { id } })
    if (!zone) return res.status(404).json({ success: false, message: "Zone not found" })
    const updated = await prisma.zone.update({
      where: { id },
      data: { isActive: !zone.isActive },
    })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}
