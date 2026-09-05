import prisma from "../../prisma/client.js"
import { z } from "zod"

const trainSchema = z.object({
  trainNumber: z.string().min(1),
  route: z.string().min(1),
  departureAt: z.string().datetime(),
  arrivalAt: z.string().datetime().optional(),
  totalCapacityKg: z.number().min(0),
  allocatedKg: z.number().min(0).default(0),
})

export async function listTrains(req, res, next) {
  try {
    const { page = 1, limit = 20, status } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const where = {}
    if (status) where.status = status

    const [trains, total] = await Promise.all([
      prisma.trainCapacity.findMany({
        where,
        orderBy: { departureAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.trainCapacity.count({ where }),
    ])

    res.json({
      success: true,
      data: trains,
      meta: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
    })
  } catch (err) {
    next(err)
  }
}

export async function getTrain(req, res, next) {
  try {
    const train = await prisma.trainCapacity.findUnique({ where: { id: req.params.id } })
    if (!train) return res.status(404).json({ success: false, message: "Train not found" })
    res.json({ success: true, data: train })
  } catch (err) {
    next(err)
  }
}

export async function createTrain(req, res, next) {
  try {
    const data = trainSchema.parse(req.body)
    const remainingKg = data.totalCapacityKg - data.allocatedKg

    const train = await prisma.trainCapacity.create({
      data: {
        ...data,
        departureAt: new Date(data.departureAt),
        arrivalAt: data.arrivalAt ? new Date(data.arrivalAt) : null,
        remainingKg,
        status: "SCHEDULED",
      },
    })

    res.status(201).json({ success: true, data: train })
  } catch (err) {
    next(err)
  }
}

export async function updateTrain(req, res, next) {
  try {
    const existing = await prisma.trainCapacity.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ success: false, message: "Train not found" })

    const update = trainSchema.partial().parse(req.body)
    const merged = { ...existing, ...update }
    merged.remainingKg = Number(merged.totalCapacityKg) - Number(merged.usedKg)

    const train = await prisma.trainCapacity.update({
      where: { id: req.params.id },
      data: {
        ...update,
        departureAt: update.departureAt ? new Date(update.departureAt) : undefined,
        arrivalAt: update.arrivalAt ? new Date(update.arrivalAt) : undefined,
        remainingKg: merged.remainingKg,
      },
    })

    res.json({ success: true, data: train })
  } catch (err) {
    next(err)
  }
}

export async function deleteTrain(req, res, next) {
  try {
    await prisma.trainCapacity.delete({ where: { id: req.params.id } })
    res.json({ success: true, message: "Train deleted" })
  } catch (err) {
    next(err)
  }
}

export async function toggleTrain(req, res, next) {
  try {
    const train = await prisma.trainCapacity.findUnique({ where: { id: req.params.id } })
    if (!train) return res.status(404).json({ success: false, message: "Train not found" })

    const updated = await prisma.trainCapacity.update({
      where: { id: req.params.id },
      data: { isActive: !train.isActive },
    })

    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}
