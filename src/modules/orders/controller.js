import prisma from "../../prisma/client.js"

export async function listOrders(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const status = req.query.status
    const paymentStatus = req.query.paymentStatus

    const where = {}
    if (status) where.status = status
    if (paymentStatus) where.paymentStatus = paymentStatus
    if (req.user.role === "CUSTOMER") {
      where.createdById = req.user.id
    }

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
    res.json({ success: true, data: order })
  } catch (err) { next(err) }
}

export async function getOrderStats(req, res, next) {
  try {
    const [total, pending, confirmed, cancelled, totalRevenue] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: "CREATED" } }),
      prisma.order.count({ where: { status: "CONFIRMED" } }),
      prisma.order.count({ where: { status: "CANCELLED" } }),
      prisma.order.aggregate({
        where: { paymentStatus: "PAID" },
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
