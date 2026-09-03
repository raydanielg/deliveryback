import prisma from "../../prisma/client.js"
import { createSurgePricingSchema } from "./validation.js"

export async function listSurgePricings(req, res, next) {
  try {
    const { activeOnly } = req.query
    const where = activeOnly === "true" ? { isActive: true } : {}
    const surges = await prisma.surgePricing.findMany({
      where,
      include: { timeSlots: true },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: surges })
  } catch (err) { next(err) }
}

export async function createSurgePricing(req, res, next) {
  try {
    const { timeSlots, ...data } = createSurgePricingSchema.parse(req.body)
    const surge = await prisma.surgePricing.create({
      data: {
        name: data.name,
        surgePercentage: data.surgePercentage,
        isActive: data.isActive,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        timeSlots: timeSlots ? {
          create: timeSlots,
        } : undefined,
      },
      include: { timeSlots: true },
    })
    res.status(201).json({ success: true, data: surge })
  } catch (err) { next(err) }
}

export async function updateSurgePricing(req, res, next) {
  try {
    const { id } = req.params
    const { timeSlots, ...data } = createSurgePricingSchema.partial().parse(req.body)

    const updateData = { ...data }
    if (data.startDate) updateData.startDate = new Date(data.startDate)
    if (data.endDate) updateData.endDate = new Date(data.endDate)

    if (timeSlots) {
      await prisma.surgePricingTimeSlot.deleteMany({ where: { surgePricingId: id } })
      updateData.timeSlots = { create: timeSlots }
    }

    const surge = await prisma.surgePricing.update({
      where: { id },
      data: updateData,
      include: { timeSlots: true },
    })
    res.json({ success: true, data: surge })
  } catch (err) { next(err) }
}

export async function deleteSurgePricing(req, res, next) {
  try {
    const { id } = req.params
    await prisma.surgePricing.delete({ where: { id } })
    res.json({ success: true, message: "Surge pricing deleted" })
  } catch (err) { next(err) }
}

export async function toggleSurgePricing(req, res, next) {
  try {
    const { id } = req.params
    const surge = await prisma.surgePricing.findUnique({ where: { id } })
    if (!surge) return res.status(404).json({ success: false, message: "Surge pricing not found" })
    const updated = await prisma.surgePricing.update({
      where: { id },
      data: { isActive: !surge.isActive },
    })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}
