import prisma from "../../prisma/client.js"
import { createPricingRuleSchema, createSurchargeSchema } from "./validation.js"

export async function listPricingRules(req, res, next) {
  try {
    const rules = await prisma.pricingRule.findMany({
      include: { surcharges: true, route: true, zone: true },
      orderBy: { priority: "desc" },
    })
    res.json({ success: true, data: rules })
  } catch (err) { next(err) }
}

export async function createPricingRule(req, res, next) {
  try {
    const data = createPricingRuleSchema.parse(req.body)
    const rule = await prisma.pricingRule.create({ data })
    res.status(201).json({ success: true, data: rule })
  } catch (err) { next(err) }
}

export async function updatePricingRule(req, res, next) {
  try {
    const { id } = req.params
    const data = createPricingRuleSchema.partial().parse(req.body)
    const rule = await prisma.pricingRule.update({ where: { id }, data })
    res.json({ success: true, data: rule })
  } catch (err) { next(err) }
}

export async function deletePricingRule(req, res, next) {
  try {
    const { id } = req.params
    await prisma.pricingRule.delete({ where: { id } })
    res.json({ success: true, message: "Pricing rule deleted" })
  } catch (err) { next(err) }
}

export async function togglePricingRule(req, res, next) {
  try {
    const { id } = req.params
    const rule = await prisma.pricingRule.findUnique({ where: { id } })
    if (!rule) return res.status(404).json({ success: false, message: "Rule not found" })
    const updated = await prisma.pricingRule.update({
      where: { id },
      data: { isActive: !rule.isActive },
    })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}

export async function listSurcharges(req, res, next) {
  try {
    const surcharges = await prisma.surcharge.findMany({ include: { pricingRule: true } })
    res.json({ success: true, data: surcharges })
  } catch (err) { next(err) }
}

export async function createSurcharge(req, res, next) {
  try {
    const data = createSurchargeSchema.parse(req.body)
    const surcharge = await prisma.surcharge.create({ data })
    res.status(201).json({ success: true, data: surcharge })
  } catch (err) { next(err) }
}

export async function deleteSurcharge(req, res, next) {
  try {
    const { id } = req.params
    await prisma.surcharge.delete({ where: { id } })
    res.json({ success: true, message: "Surcharge deleted" })
  } catch (err) { next(err) }
}

const DEFAULT_MODE_CONFIGS = {
  ROAD: { baseRate: 5000, perKgRate: 2000, insuranceRate: 0.015, taxRate: 0.18 },
  RAIL: { baseRate: 2500, perKgRate: 1500, insuranceRate: 0.02, taxRate: 0.18 },
  AIR: { baseRate: 15000, perKgRate: 8000, insuranceRate: 0.03, taxRate: 0.18 },
}

export async function getModePricingConfig(req, res, next) {
  try {
    const { transportMode } = req.params
    const validModes = ["ROAD", "RAIL", "AIR"]
    if (!validModes.includes(transportMode)) {
      return res.status(400).json({ success: false, message: "Invalid transport mode. Valid modes: ROAD, RAIL, AIR" })
    }

    const rules = await prisma.pricingRule.findMany({
      where: {
        transportMode,
        isActive: true,
        effectiveFrom: { lte: new Date() },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: new Date() } },
        ],
      },
      include: { surcharges: { where: { isActive: true } } },
      orderBy: { priority: "desc" },
    })

    const defaults = DEFAULT_MODE_CONFIGS[transportMode]

    res.json({
      success: true,
      data: {
        transportMode,
        defaults,
        rules,
        ruleCount: rules.length,
      },
    })
  } catch (err) { next(err) }
}

export async function updateModePricingConfig(req, res, next) {
  try {
    const { transportMode } = req.params
    const validModes = ["ROAD", "RAIL", "AIR"]
    if (!validModes.includes(transportMode)) {
      return res.status(400).json({ success: false, message: "Invalid transport mode. Valid modes: ROAD, RAIL, AIR" })
    }

    const { baseRate, perKgRate, insuranceRate, taxRate, serviceLevel } = req.body

    const existing = await prisma.pricingRule.findFirst({
      where: {
        transportMode,
        serviceLevel: serviceLevel || "STANDARD",
        type: "WEIGHT",
        isActive: true,
      },
    })

    if (existing) {
      const updated = await prisma.pricingRule.update({
        where: { id: existing.id },
        data: {
          baseFare: baseRate !== undefined ? baseRate : existing.baseFare,
          perKg: perKgRate !== undefined ? perKgRate : existing.perKg,
          conditions: {
            ...(existing.conditions || {}),
            insuranceRate: insuranceRate !== undefined ? insuranceRate : existing.conditions?.insuranceRate,
            taxRate: taxRate !== undefined ? taxRate : existing.conditions?.taxRate,
          },
        },
      })
      res.json({ success: true, data: updated, message: "Mode pricing configuration updated" })
    } else {
      const created = await prisma.pricingRule.create({
        data: {
          name: `${transportMode} ${serviceLevel || "STANDARD"} Pricing`,
          code: `${transportMode}_${serviceLevel || "STANDARD"}_WEIGHT`,
          type: "WEIGHT",
          transportMode,
          serviceLevel: serviceLevel || "STANDARD",
          baseFare: baseRate || DEFAULT_MODE_CONFIGS[transportMode].baseRate,
          perKg: perKgRate || DEFAULT_MODE_CONFIGS[transportMode].perKgRate,
          priority: 10,
          conditions: {
            insuranceRate: insuranceRate !== undefined ? insuranceRate : DEFAULT_MODE_CONFIGS[transportMode].insuranceRate,
            taxRate: taxRate !== undefined ? taxRate : DEFAULT_MODE_CONFIGS[transportMode].taxRate,
          },
        },
      })
      res.status(201).json({ success: true, data: created, message: "Mode pricing configuration created" })
    }
  } catch (err) { next(err) }
}
