import prisma from "../../prisma/client.js"
import { z } from "zod"

const createDriverSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string(),
  password: z.string().min(8),
  licenseNumber: z.string(),
  licenseExpiry: z.string().datetime().optional(),
  carrierId: z.string().optional(),
})

export async function listDrivers(req, res, next) {
  try {
    const drivers = await prisma.driver.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
        carrier: true,
      },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: drivers })
  } catch (err) { next(err) }
}

export async function createDriver(req, res, next) {
  try {
    const data = createDriverSchema.parse(req.body)
    const bcrypt = await import("bcryptjs")
    const hashedPassword = await bcrypt.hash(data.password, 12)

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        password: hashedPassword,
        role: "DRIVER",
        isVerified: true,
      },
    })

    const driver = await prisma.driver.create({
      data: {
        userId: user.id,
        licenseNumber: data.licenseNumber,
        licenseExpiry: data.licenseExpiry ? new Date(data.licenseExpiry) : null,
        carrierId: data.carrierId || null,
      },
      include: { user: { select: { name: true, email: true, phone: true } } },
    })

    res.status(201).json({ success: true, data: driver })
  } catch (err) { next(err) }
}

export async function updateDriverStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status } = req.body

    const driver = await prisma.driver.update({
      where: { id },
      data: { status },
    })
    res.json({ success: true, data: driver })
  } catch (err) { next(err) }
}
