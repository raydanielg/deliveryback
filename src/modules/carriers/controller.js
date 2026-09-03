import prisma from "../../prisma/client.js"
import { z } from "zod"

const createCarrierSchema = z.object({
  name: z.string().min(2),
  type: z.enum(["XERIN", "PARTNER", "THIRD_PARTY"]).default("PARTNER"),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().default("Tanzania"),
  licenseNo: z.string().optional(),
})

export async function listCarriers(req, res, next) {
  try {
    const carriers = await prisma.carrier.findMany({
      include: { _count: { select: { drivers: true, vehicles: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: carriers })
  } catch (err) { next(err) }
}

export async function createCarrier(req, res, next) {
  try {
    const data = createCarrierSchema.parse(req.body)
    const carrier = await prisma.carrier.create({ data })
    res.status(201).json({ success: true, data: carrier })
  } catch (err) { next(err) }
}

export async function getCarrier(req, res, next) {
  try {
    const { id } = req.params
    const carrier = await prisma.carrier.findUnique({
      where: { id },
      include: { drivers: { include: { user: { select: { name: true, phone: true } } } }, vehicles: true },
    })
    if (!carrier) return res.status(404).json({ success: false, message: "Carrier not found" })
    res.json({ success: true, data: carrier })
  } catch (err) { next(err) }
}
