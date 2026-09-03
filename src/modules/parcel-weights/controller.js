import prisma from "../../prisma/client.js"
import { createParcelWeightSchema } from "./validation.js"

export async function listParcelWeights(req, res, next) {
  try {
    const { activeOnly } = req.query
    const where = activeOnly === "true" ? { isActive: true } : {}
    const weights = await prisma.parcelWeight.findMany({
      where,
      include: { _count: { select: { fareWeights: true } } },
      orderBy: { minWeight: "asc" },
    })
    res.json({ success: true, data: weights })
  } catch (err) { next(err) }
}

export async function createParcelWeight(req, res, next) {
  try {
    const data = createParcelWeightSchema.parse(req.body)
    const weight = await prisma.parcelWeight.create({ data })
    res.status(201).json({ success: true, data: weight })
  } catch (err) { next(err) }
}

export async function updateParcelWeight(req, res, next) {
  try {
    const { id } = req.params
    const data = createParcelWeightSchema.partial().parse(req.body)
    const weight = await prisma.parcelWeight.update({ where: { id }, data })
    res.json({ success: true, data: weight })
  } catch (err) { next(err) }
}

export async function deleteParcelWeight(req, res, next) {
  try {
    const { id } = req.params
    await prisma.parcelWeight.delete({ where: { id } })
    res.json({ success: true, message: "Parcel weight deleted" })
  } catch (err) { next(err) }
}

export async function toggleParcelWeight(req, res, next) {
  try {
    const { id } = req.params
    const weight = await prisma.parcelWeight.findUnique({ where: { id } })
    if (!weight) return res.status(404).json({ success: false, message: "Weight not found" })
    const updated = await prisma.parcelWeight.update({
      where: { id },
      data: { isActive: !weight.isActive },
    })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}
