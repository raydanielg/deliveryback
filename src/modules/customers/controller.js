import prisma from "../../prisma/client.js"
import { z } from "zod"
import { logAction } from "../../middleware/audit-logger.js"

// XERIN Module 12 — Customers.
// name/email live on the User record; the Customer profile carries phone (the real
// identity — spec D14), customerCode (XC-00001), balance, status and delivery defaults.

const createCustomerSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(7),
  email: z.string().email().optional(),
  altPhone: z.string().optional(),
  type: z.enum(["GUEST", "INDIVIDUAL", "BUSINESS", "CORPORATE"]).default("INDIVIDUAL"),
  organizationId: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().default("Tanzania"),
  defaultOption: z.enum(["COLLECT_AT_TAZARA_FREE", "COLLECT_AT_OTHER_POINT_CHARGED", "HOME_OFFICE_DELIVERY_CHARGED"]).optional(),
  defaultZoneId: z.string().optional(),
  defaultAddress: z.string().optional(),
})

const updateCustomerSchema = createCustomerSchema.partial().extend({
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
})

async function generateCustomerCode(tx = prisma) {
  const latest = await tx.customer.findFirst({
    where: { customerCode: { startsWith: "XC-" } },
    orderBy: { customerCode: "desc" },
    select: { customerCode: true },
  })
  const seq = latest ? parseInt(latest.customerCode.slice(3), 10) + 1 : 1
  return `XC-${String(seq).padStart(5, "0")}`
}

const CUSTOMER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
  organization: { select: { id: true, name: true } },
  defaultZone: { select: { id: true, name: true, feeAmount: true } },
}

export async function listCustomers(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const { search, status } = req.query

    const where = {}
    if (status) where.status = status
    if (search) {
      where.OR = [
        { customerCode: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
        { altPhone: { contains: search } },
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
      ]
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: CUSTOMER_INCLUDE,
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

// Quick lookup for Dubai receiving — find a customer by phone, code or name.
// Returns up to 10 matches so the officer can pick the right person when names
// collide (spec screen 10.2 — "Wateja 2 wanafanana").
export async function lookupCustomer(req, res, next) {
  try {
    const q = (req.query.q || "").trim()
    if (!q) return res.status(400).json({ success: false, message: "Query parameter q is required" })

    const matches = await prisma.customer.findMany({
      where: {
        OR: [
          { phone: { contains: q } },
          { altPhone: { contains: q } },
          { customerCode: { equals: q, mode: "insensitive" } },
          { user: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      include: CUSTOMER_INCLUDE,
      take: 10,
    })

    res.json({ success: true, data: matches })
  } catch (err) { next(err) }
}

export async function createCustomer(req, res, next) {
  try {
    const data = createCustomerSchema.parse(req.body)

    // D14 — phone is the real identity. An exact phone match blocks creation;
    // similar names are returned as a warning so staff pick the right record.
    const phoneMatch = await prisma.customer.findFirst({
      where: { OR: [{ phone: data.phone }, { altPhone: data.phone }] },
      include: CUSTOMER_INCLUDE,
    })
    if (phoneMatch) {
      return res.status(409).json({
        success: false,
        message: `Phone ${data.phone} already belongs to ${phoneMatch.user?.name} (${phoneMatch.customerCode || phoneMatch.id})`,
        data: phoneMatch,
      })
    }

    const similarNames = await prisma.customer.findMany({
      where: { user: { name: { contains: data.name.split(" ")[0], mode: "insensitive" } } },
      include: { user: { select: { name: true, phone: true } } },
      take: 5,
    })

    const bcrypt = await import("bcryptjs")
    const hashedPassword = await bcrypt.hash(`Xerin${Date.now()}!`, 12)
    const email = data.email || `${data.phone.replace(/\D/g, "")}@customer.xerin.local`

    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      return res.status(409).json({ success: false, message: "A user with this email already exists" })
    }

    const customer = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name,
          email,
          phone: data.phone,
          password: hashedPassword,
          role: "CUSTOMER",
          isVerified: true,
        },
      })
      return tx.customer.create({
        data: {
          userId: user.id,
          customerCode: await generateCustomerCode(tx),
          phone: data.phone,
          altPhone: data.altPhone,
          email: data.email || null,
          type: data.type,
          organizationId: data.organizationId,
          address: data.address,
          city: data.city,
          region: data.region,
          country: data.country,
          defaultOption: data.defaultOption,
          defaultZoneId: data.defaultZoneId,
          defaultAddress: data.defaultAddress,
        },
        include: CUSTOMER_INCLUDE,
      })
    })

    await logAction({
      userId: req.user.id, action: "CREATE_CUSTOMER", entity: "Customer", entityId: customer.id,
      changes: { customerCode: customer.customerCode, name: data.name, phone: data.phone }, req,
    })

    res.status(201).json({
      success: true,
      data: customer,
      warnings: similarNames.length
        ? [`${similarNames.length} similar customer(s) exist: ${similarNames.map((c) => c.user?.name).join(", ")}`]
        : [],
      message: `Customer ${customer.customerCode} created`,
    })
  } catch (err) { next(err) }
}

export async function getCustomer(req, res, next) {
  try {
    const { id } = req.params
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        ...CUSTOMER_INCLUDE,
        addresses: true,
        orders: { take: 10, orderBy: { createdAt: "desc" } },
        shipments: {
          take: 20,
          orderBy: { createdAt: "desc" },
          select: { id: true, trackingNumber: true, status: true, totalAmount: true, paymentStatus: true, createdAt: true },
        },
        ratings: true,
      },
    })
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" })

    const invoices = await prisma.invoice.findMany({
      where: { shipment: { customerId: id } },
      select: { id: true, invoiceNumber: true, total: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    })

    res.json({ success: true, data: { ...customer, invoices } })
  } catch (err) { next(err) }
}

export async function updateCustomer(req, res, next) {
  try {
    const { id } = req.params
    const data = updateCustomerSchema.parse(req.body)

    const existing = await prisma.customer.findUnique({ where: { id }, include: { user: true } })
    if (!existing) return res.status(404).json({ success: false, message: "Customer not found" })

    // Phone change must not collide with another customer (D14).
    if (data.phone && data.phone !== existing.phone) {
      const clash = await prisma.customer.findFirst({
        where: { OR: [{ phone: data.phone }, { altPhone: data.phone }], NOT: { id } },
      })
      if (clash) return res.status(409).json({ success: false, message: `Phone ${data.phone} already belongs to another customer` })
    }

    const customer = await prisma.$transaction(async (tx) => {
      if (data.name || data.email || data.phone) {
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            ...(data.name ? { name: data.name } : {}),
            ...(data.email ? { email: data.email } : {}),
            ...(data.phone ? { phone: data.phone } : {}),
          },
        })
      }
      return tx.customer.update({
        where: { id },
        data: {
          phone: data.phone,
          altPhone: data.altPhone,
          email: data.email,
          type: data.type,
          organizationId: data.organizationId,
          address: data.address,
          city: data.city,
          region: data.region,
          country: data.country,
          status: data.status,
          defaultOption: data.defaultOption,
          defaultZoneId: data.defaultZoneId,
          defaultAddress: data.defaultAddress,
        },
        include: CUSTOMER_INCLUDE,
      })
    })

    await logAction({
      userId: req.user.id, action: "UPDATE_CUSTOMER", entity: "Customer", entityId: id,
      changes: data, req,
    })

    res.json({ success: true, data: customer })
  } catch (err) { next(err) }
}

// Suspend/reactivate — spec §4.3: never delete, suspend instead.
export async function setCustomerStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status } = z.object({ status: z.enum(["ACTIVE", "BLOCKED"]) }).parse(req.body)

    const customer = await prisma.customer.update({ where: { id }, data: { status }, include: CUSTOMER_INCLUDE })

    await logAction({
      userId: req.user.id, action: `CUSTOMER_${status}`, entity: "Customer", entityId: id,
      changes: { status }, req,
    })

    res.json({ success: true, data: customer, message: `Customer ${status === "BLOCKED" ? "blocked" : "reactivated"}` })
  } catch (err) { next(err) }
}

export async function getCustomerStats(req, res, next) {
  try {
    const { id } = req.params

    const [totalShipments, totalSpent, deliveredCount, activeCount, outstanding] = await Promise.all([
      prisma.shipment.count({ where: { customerId: id } }),
      prisma.invoice.aggregate({
        where: { shipment: { customerId: id }, status: "PAID" },
        _sum: { total: true },
      }),
      prisma.shipment.count({ where: { customerId: id, status: { in: ["DELIVERED", "CLOSED"] } } }),
      prisma.shipment.count({
        where: {
          customerId: id,
          status: { in: ["BOOKED", "AWAITING_PICKUP", "DRIVER_ASSIGNED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "RECEIVED_DUBAI", "AWAITING_CONSOLIDATION", "DEPARTED_DUBAI", "ARRIVED_TANZANIA", "ON_SHELF", "INVOICED"] },
        },
      }),
      prisma.invoice.aggregate({
        where: { shipment: { customerId: id }, status: "UNPAID" },
        _sum: { total: true },
      }),
    ])

    res.json({
      success: true,
      data: {
        totalShipments,
        totalSpent: totalSpent._sum.total || 0,
        outstanding: outstanding._sum.total || 0,
        deliveredCount,
        activeCount,
      },
    })
  } catch (err) { next(err) }
}
