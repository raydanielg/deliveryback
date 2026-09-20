import prisma from "../../prisma/client.js"
import { orderScope } from "../../utils/branch-scope.js"

export async function listOrders(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const status = req.query.status
    const paymentStatus = req.query.paymentStatus

    const where = {}
    if (status) where.status = status
    if (paymentStatus) where.paymentStatus = paymentStatus
    const scope = await orderScope(req.user)
    if (scope) where.AND = [scope]

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          createdBy: { select: { name: true, email: true } },
          customer: { select: { phone: true, user: { select: { name: true } } } },
          shipments: { select: { id: true, trackingNumber: true, status: true } },
          payments: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ])

    res.json({
      success: true,
      data: orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) { next(err) }
}

export async function getOrder(req, res, next) {
  try {
    const { id } = req.params
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        createdBy: { select: { name: true, email: true } },
        customer: true,
        organization: true,
        quote: true,
        shipments: {
          include: {
            fromAddress: true,
            toAddress: true,
            packages: true,
            trackingEvents: { orderBy: { createdAt: "desc" }, take: 5 },
          },
        },
        payments: true,
        invoices: true,
      },
    })
    if (!order) return res.status(404).json({ success: false, message: "Order not found" })

    // Previously unscoped — any authenticated customer could fetch any order by guessing/
    // incrementing its ID and see the full record: other customers' shipments, addresses,
    // payments, and invoices. listOrders already scoped by createdById; this didn't.
    const scope = await orderScope(req.user)
    if (scope && !(await prisma.order.findFirst({ where: { AND: [{ id: order.id }, scope] }, select: { id: true } }))) {
      return res.status(404).json({ success: false, message: "Order not found" })
    }

    res.json({ success: true, data: order })
  } catch (err) { next(err) }
}

export async function getOrderStats(req, res, next) {
  try {
    // Same visibility rule as the list: customers/drivers/branch roles only count what they can see.
    const scope = await orderScope(req.user)
    const base = scope ? { AND: [scope] } : {}
    const [total, pending, confirmed, cancelled, totalRevenue] = await Promise.all([
      prisma.order.count({ where: base }),
      prisma.order.count({ where: { ...base, status: "CREATED" } }),
      prisma.order.count({ where: { ...base, status: "CONFIRMED" } }),
      prisma.order.count({ where: { ...base, status: "CANCELLED" } }),
      prisma.order.aggregate({
        where: { ...base, paymentStatus: "PAID" },
        _sum: { totalAmount: true },
      }),
    ])

    res.json({
      success: true,
      data: {
        total,
        pending,
        confirmed,
        cancelled,
        totalRevenue: totalRevenue._sum.totalAmount || 0,
      },
    })
  } catch (err) { next(err) }
}
