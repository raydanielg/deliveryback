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
