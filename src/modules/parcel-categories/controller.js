import prisma from "../../prisma/client.js"
import { createParcelCategorySchema } from "./validation.js"

export async function listParcelCategories(req, res, next) {
  try {
    const { activeOnly } = req.query
    const where = activeOnly === "true" ? { isActive: true } : {}
    const categories = await prisma.parcelCategory.findMany({
      where,
      include: { _count: { select: { shipments: true, fareWeights: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: categories })
  } catch (err) { next(err) }
}

export async function getParcelCategory(req, res, next) {
  try {
    const { id } = req.params
    const category = await prisma.parcelCategory.findUnique({
      where: { id },
      include: { fareWeights: { include: { parcelWeight: true, parcelFare: true } } },
    })
    if (!category) return res.status(404).json({ success: false, message: "Parcel category not found" })
    res.json({ success: true, data: category })
  } catch (err) { next(err) }
}

export async function createParcelCategory(req, res, next) {
  try {
    const data = createParcelCategorySchema.parse(req.body)
    const category = await prisma.parcelCategory.create({ data })
    res.status(201).json({ success: true, data: category })
  } catch (err) { next(err) }
}

export async function updateParcelCategory(req, res, next) {
  try {
    const { id } = req.params
    const data = createParcelCategorySchema.partial().parse(req.body)
    const category = await prisma.parcelCategory.update({ where: { id }, data })
    res.json({ success: true, data: category })
  } catch (err) { next(err) }
}

export async function deleteParcelCategory(req, res, next) {
  try {
    const { id } = req.params
    await prisma.parcelCategory.delete({ where: { id } })
    res.json({ success: true, message: "Parcel category deleted" })
  } catch (err) { next(err) }
}

export async function toggleParcelCategory(req, res, next) {
  try {
    const { id } = req.params
    const category = await prisma.parcelCategory.findUnique({ where: { id } })
    if (!category) return res.status(404).json({ success: false, message: "Category not found" })
    const updated = await prisma.parcelCategory.update({
      where: { id },
      data: { isActive: !category.isActive },
    })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}
