import prisma from "../../prisma/client.js"
import { z } from "zod"

const createVehicleSchema = z.object({
  carrierId: z.string(),
  registrationNo: z.string().min(3),
  type: z.enum(["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP", "TRUCK", "TRAILER", "CONTAINER"]),
  capacityKg: z.number().min(0),
  capacityM3: z.number().min(0).optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1990).optional(),
})

export async function listVehicles(req, res, next) {
  try {
    const vehicles = await prisma.vehicle.findMany({
      include: { carrier: true },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: vehicles })
  } catch (err) { next(err) }
}

export async function createVehicle(req, res, next) {
  try {
    const data = createVehicleSchema.parse(req.body)
    const vehicle = await prisma.vehicle.create({ data })
    res.status(201).json({ success: true, data: vehicle })
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
