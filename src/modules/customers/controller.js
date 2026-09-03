import prisma from "../../prisma/client.js"
import { z } from "zod"

const createCustomerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string(),
  altPhone: z.string().optional(),
  type: z.enum(["INDIVIDUAL", "BUSINESS", "CORPORATE", "NGO", "GOVERNMENT"]).default("INDIVIDUAL"),
  organizationName: z.string().optional(),
  organizationId: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().default("Tanzania"),
})

export async function listCustomers(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const search = req.query.search

    const where = {}
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ]
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
          organization: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.customer.count({ where }),
    ])

    res.json({
      success: true,
      data: customers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) { next(err) }
}

export async function createCustomer(req, res, next) {
  try {
    const data = createCustomerSchema.parse(req.body)

    const existing = await prisma.customer.findFirst({
      where: { OR: [{ email: data.email }, { phone: data.phone }] },
    })
    if (existing) return res.status(400).json({ success: false, message: "Customer with this email or phone already exists" })

    const bcrypt = await import("bcryptjs")
    const hashedPassword = await bcrypt.hash("TempPass123!", 12)

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        password: hashedPassword,
        role: "CUSTOMER",
        isVerified: true,
      },
    })

    const customer = await prisma.customer.create({
      data: {
        userId: user.id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        altPhone: data.altPhone,
        type: data.type,
        organizationName: data.organizationName,
        organizationId: data.organizationId,
        address: data.address,
        city: data.city,
        region: data.region,
        country: data.country,
      },
      include: { user: { select: { name: true, email: true, phone: true } } },
    })

    res.status(201).json({ success: true, data: customer })
  } catch (err) { next(err) }
}

export async function getCustomer(req, res, next) {
  try {
    const { id } = req.params
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true, phone: true, avatar: true } },
        organization: true,
        addresses: true,
        orders: { take: 10, orderBy: { createdAt: "desc" } },
        shipments: { take: 10, orderBy: { createdAt: "desc" }, select: { id: true, trackingNumber: true, status: true, totalAmount: true } },
        ratings: true,
      },
    })
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" })
    res.json({ success: true, data: customer })
  } catch (err) { next(err) }
}

export async function updateCustomer(req, res, next) {
  try {
    const { id } = req.params
    const data = createCustomerSchema.partial().parse(req.body)

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: data.name,
        phone: data.phone,
        altPhone: data.altPhone,
        type: data.type,
        organizationName: data.organizationName,
        organizationId: data.organizationId,
        address: data.address,
        city: data.city,
        region: data.region,
        country: data.country,
      },
    })

    res.json({ success: true, data: customer })
  } catch (err) { next(err) }
}

export async function getCustomerStats(req, res, next) {
  try {
    const { id } = req.params

    const [totalShipments, totalSpent, deliveredCount, activeCount] = await Promise.all([
      prisma.shipment.count({ where: { createdById: id } }),
      prisma.shipment.aggregate({
        where: { createdById: id, paymentStatus: "PAID" },
        _sum: { totalAmount: true },
      }),
      prisma.shipment.count({ where: { createdById: id, status: "DELIVERED" } }),
      prisma.shipment.count({
        where: {
          createdById: id,
          status: { in: ["BOOKED", "AWAITING_PICKUP", "DRIVER_ASSIGNED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"] },
        },
      }),
    ])

    res.json({
      success: true,
      data: {
        totalShipments,
        totalSpent: totalSpent._sum.totalAmount || 0,
        deliveredCount,
        activeCount,
      },
    })
  } catch (err) { next(err) }
}
