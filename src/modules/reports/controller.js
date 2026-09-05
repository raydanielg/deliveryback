import prisma from "../../prisma/client.js"
import { z } from "zod"

const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  period: z.enum(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]).default("MONTHLY"),
})

/**
 * GET /api/v1/reports/overview
 * Overall system statistics with date range filtering
 */
export async function getOverviewReport(req, res, next) {
  try {
    const { startDate, endDate, period } = dateRangeSchema.parse(req.query)

    const dateFilter = {}
    if (startDate || endDate) {
      dateFilter.createdAt = {}
      if (startDate) dateFilter.createdAt.gte = new Date(startDate)
      if (endDate) dateFilter.createdAt.lte = new Date(endDate)
    }

    const [
      totalShipments,
      totalOrders,
      totalRevenue,
      totalWeight,
      deliveredCount,
      failedCount,
      activeCustomers,
      shipmentsByMode,
      shipmentsByStatus,
      recentShipments,
    ] = await Promise.all([
      prisma.shipment.count({ where: dateFilter }),
      prisma.order.count({ where: dateFilter }),
      prisma.payment.aggregate({
        where: { ...dateFilter, status: "PAID" },
        _sum: { amount: true },
      }),
      prisma.shipment.aggregate({
        where: dateFilter,
        _sum: { chargeableWeightKg: true },
      }),
      prisma.shipment.count({ where: { ...dateFilter, status: "DELIVERED" } }),
      prisma.shipment.count({ where: { ...dateFilter, status: { in: ["FAILED", "DELIVERY_FAILED", "CANCELLED"] } } }),
      prisma.customer.count({
        where: {
          shipments: { some: { ...dateFilter } },
        },
      }),
      prisma.shipment.groupBy({
        by: ["transportMode"],
        where: dateFilter,
        _count: true,
        _sum: { chargeableWeightKg: true, totalAmount: true },
      }),
      prisma.shipment.groupBy({
        by: ["status"],
        where: dateFilter,
        _count: true,
      }),
      prisma.shipment.findMany({
        where: dateFilter,
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { fromAddress: true, toAddress: true },
      }),
    ])

    const deliverySuccessRate = totalShipments > 0
      ? Number(((deliveredCount / totalShipments) * 100).toFixed(2))
      : 0

    const avgDeliveryTime = await getAverageDeliveryTime(dateFilter)

    res.json({
      success: true,
      data: {
        totalShipments,
        totalOrders,
        totalRevenue: totalRevenue._sum.amount || 0,
        totalWeightKg: totalWeight._sum.chargeableWeightKg || 0,
        deliveredCount,
        failedCount,
        deliverySuccessRate,
        avgDeliveryTimeHours: avgDeliveryTime,
        activeCustomers,
        shipmentsByMode: shipmentsByMode.map((s) => ({
          mode: s.transportMode,
          count: s._count,
          weightKg: s._sum.chargeableWeightKg || 0,
          revenue: s._sum.totalAmount || 0,
        })),
        shipmentsByStatus: shipmentsByStatus.map((s) => ({
          status: s.status,
          count: s._count,
        })),
        recentShipments,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/reports/by-mode
 * Shipment breakdown by transport mode
 */
export async function getModeReport(req, res, next) {
  try {
    const { startDate, endDate } = dateRangeSchema.parse(req.query)

    const dateFilter = {}
    if (startDate || endDate) {
      dateFilter.createdAt = {}
      if (startDate) dateFilter.createdAt.gte = new Date(startDate)
      if (endDate) dateFilter.createdAt.lte = new Date(endDate)
    }

    const modes = ["ROAD", "RAIL", "AIR", "SEA", "COURIER"]
    const results = []

    for (const mode of modes) {
      const [count, weight, revenue, delivered, failed] = await Promise.all([
        prisma.shipment.count({ where: { ...dateFilter, transportMode: mode } }),
        prisma.shipment.aggregate({
          where: { ...dateFilter, transportMode: mode },
          _sum: { chargeableWeightKg: true, totalAmount: true },
        }),
        prisma.shipment.aggregate({
          where: { ...dateFilter, transportMode: mode },
          _sum: { totalAmount: true },
        }),
        prisma.shipment.count({ where: { ...dateFilter, transportMode: mode, status: "DELIVERED" } }),
        prisma.shipment.count({ where: { ...dateFilter, transportMode: mode, status: { in: ["FAILED", "DELIVERY_FAILED", "CANCELLED"] } } }),
      ])

      if (count > 0) {
        results.push({
          mode,
          totalShipments: count,
          totalWeightKg: weight._sum.chargeableWeightKg || 0,
          totalRevenue: revenue._sum.totalAmount || 0,
          delivered,
          failed,
          successRate: count > 0 ? Number(((delivered / count) * 100).toFixed(2)) : 0,
        })
      }
    }

    res.json({ success: true, data: results })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/reports/revenue
 * Revenue report with breakdown
 */
export async function getRevenueReport(req, res, next) {
  try {
    const { startDate, endDate } = dateRangeSchema.parse(req.query)

    const dateFilter = {}
    if (startDate || endDate) {
      dateFilter.createdAt = {}
      if (startDate) dateFilter.createdAt.gte = new Date(startDate)
      if (endDate) dateFilter.createdAt.lte = new Date(endDate)
    }

    const [payments, outstanding, refunds, invoices] = await Promise.all([
      prisma.payment.aggregate({
        where: { ...dateFilter, status: "PAID" },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.order.aggregate({
        where: { ...dateFilter, paymentStatus: { in: ["PENDING", "PARTIAL"] } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { ...dateFilter, status: "REFUNDED" },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.invoice.aggregate({
        where: { ...dateFilter, status: "UNPAID" },
        _sum: { total: true },
        _count: true,
      }),
    ])

    // Revenue by payment method
    const revenueByMethod = await prisma.payment.groupBy({
      by: ["method"],
      where: { ...dateFilter, status: "PAID" },
      _sum: { amount: true },
      _count: true,
    })

    res.json({
      success: true,
      data: {
        totalRevenue: payments._sum.amount || 0,
        totalPayments: payments._count,
        outstandingPayments: outstanding._sum.totalAmount || 0,
        outstandingCount: outstanding._count,
        refundedAmount: refunds._sum.amount || 0,
        refundCount: refunds._count,
        unpaidInvoices: invoices._sum.total || 0,
        unpaidInvoiceCount: invoices._count,
        revenueByMethod: revenueByMethod.map((r) => ({
          method: r.method,
          amount: r._sum.amount || 0,
          count: r._count,
        })),
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/reports/top-routes
 * Top shipping routes by volume
 */
export async function getTopRoutesReport(req, res, next) {
  try {
    const { startDate, endDate, limit = 10 } = req.query

    const dateFilter = {}
    if (startDate || endDate) {
      dateFilter.createdAt = {}
      if (startDate) dateFilter.createdAt.gte = new Date(startDate)
      if (endDate) dateFilter.createdAt.lte = new Date(endDate)
    }

    const shipments = await prisma.shipment.findMany({
      where: dateFilter,
      include: {
        fromAddress: { select: { city: true, country: true } },
        toAddress: { select: { city: true, country: true } },
      },
      select: {
        fromAddress: { select: { city: true, country: true } },
        toAddress: { select: { city: true, country: true } },
        chargeableWeightKg: true,
        totalAmount: true,
        status: true,
      },
    })

    // Group by route
    const routeMap = new Map()
    for (const s of shipments) {
      const routeKey = `${s.fromAddress.city} → ${s.toAddress.city}`
      const existing = routeMap.get(routeKey) || {
        route: routeKey,
        origin: s.fromAddress.city,
        destination: s.toAddress.city,
        count: 0,
        weightKg: 0,
        revenue: 0,
        delivered: 0,
      }
      existing.count++
      existing.weightKg += Number(s.chargeableWeightKg)
      existing.revenue += Number(s.totalAmount)
      if (s.status === "DELIVERED") existing.delivered++
      routeMap.set(routeKey, existing)
    }

    const routes = Array.from(routeMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, Number(limit))

    res.json({ success: true, data: routes })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/reports/exceptions
 * Exception report with breakdown by type
 */
export async function getExceptionReport(req, res, next) {
  try {
    const { startDate, endDate } = dateRangeSchema.parse(req.query)

    const dateFilter = {}
    if (startDate || endDate) {
      dateFilter.createdAt = {}
      if (startDate) dateFilter.createdAt.gte = new Date(startDate)
      if (endDate) dateFilter.createdAt.lte = new Date(endDate)
    }

    const [byType, byStatus, total, resolved, open] = await Promise.all([
      prisma.shipmentException.groupBy({
        by: ["type"],
        where: dateFilter,
        _count: true,
      }),
      prisma.shipmentException.groupBy({
        by: ["status"],
        where: dateFilter,
        _count: true,
      }),
      prisma.shipmentException.count({ where: dateFilter }),
      prisma.shipmentException.count({ where: { ...dateFilter, status: "RESOLVED" } }),
      prisma.shipmentException.count({ where: { ...dateFilter, status: { in: ["OPEN", "IN_REVIEW", "ESCALATED"] } } }),
    ])

    res.json({
      success: true,
      data: {
        total,
        resolved,
        open,
        byType: byType.map((t) => ({ type: t.type, count: t._count })),
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/reports/warehouse
 * Warehouse stock report
 */
export async function getWarehouseReport(req, res, next) {
  try {
    const stations = await prisma.station.findMany({
      where: { type: "WAREHOUSE" },
      include: {
        inventory: {
          include: {
            shipment: {
              select: {
                trackingNumber: true,
                chargeableWeightKg: true,
                status: true,
                transportMode: true,
              },
            },
          },
        },
      },
    })

    const report = stations.map((station) => ({
      stationId: station.id,
      stationName: station.name,
      stationCode: station.code,
      totalItems: station.inventory.length,
      receivedItems: station.inventory.filter((i) => i.status === "RECEIVED").length,
      dispatchedItems: station.inventory.filter((i) => i.status === "DISPATCHED").length,
      totalWeightKg: station.inventory.reduce((sum, i) => sum + Number(i.shipment.chargeableWeightKg), 0),
      capacityKg: station.capacityKg ? Number(station.capacityKg) : null,
      utilization: station.capacityKg
        ? Number(((station.inventory.reduce((sum, i) => sum + Number(i.shipment.chargeableWeightKg), 0) / Number(station.capacityKg)) * 100).toFixed(2))
        : null,
    }))

    res.json({ success: true, data: report })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/reports/sgr
 * SGR-specific report
 */
export async function getSGRReport(req, res, next) {
  try {
    const { startDate, endDate } = dateRangeSchema.parse(req.query)

    const dateFilter = {}
    if (startDate || endDate) {
      dateFilter.createdAt = {}
      if (startDate) dateFilter.createdAt.gte = new Date(startDate)
      if (endDate) dateFilter.createdAt.lte = new Date(endDate)
    }

    const sgrShipments = await prisma.shipment.findMany({
      where: { ...dateFilter, transportMode: "RAIL" },
      include: {
        originStation: { select: { name: true, code: true } },
        destinationStation: { select: { name: true, code: true } },
      },
    })

    const byStation = new Map()
    for (const s of sgrShipments) {
      const originKey = s.originStation?.name || "Unknown"
      const existing = byStation.get(originKey) || { station: originKey, count: 0, weightKg: 0, revenue: 0 }
      existing.count++
      existing.weightKg += Number(s.chargeableWeightKg)
      existing.revenue += Number(s.totalAmount)
      byStation.set(originKey, existing)
    }

    res.json({
      success: true,
      data: {
        totalSGRShipments: sgrShipments.length,
        totalWeightKg: sgrShipments.reduce((sum, s) => sum + Number(s.chargeableWeightKg), 0),
        totalRevenue: sgrShipments.reduce((sum, s) => sum + Number(s.totalAmount), 0),
        byOriginStation: Array.from(byStation.values()),
        sgrServiceTypes: sgrShipments.reduce((acc, s) => {
          acc[s.sgrServiceType || "UNKNOWN"] = (acc[s.sgrServiceType || "UNKNOWN"] || 0) + 1
          return acc
        }, {}),
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/reports/air-cargo
 * Air Cargo-specific report
 */
export async function getAirCargoReport(req, res, next) {
  try {
    const { startDate, endDate } = dateRangeSchema.parse(req.query)

    const dateFilter = {}
    if (startDate || endDate) {
      dateFilter.createdAt = {}
      if (startDate) dateFilter.createdAt.gte = new Date(startDate)
      if (endDate) dateFilter.createdAt.lte = new Date(endDate)
    }

    const airShipments = await prisma.shipment.findMany({
      where: { ...dateFilter, transportMode: "AIR" },
    })

    res.json({
      success: true,
      data: {
        totalAirCargoShipments: airShipments.length,
        totalWeightKg: airShipments.reduce((sum, s) => sum + Number(s.chargeableWeightKg), 0),
        totalRevenue: airShipments.reduce((sum, s) => sum + Number(s.totalAmount), 0),
        byServiceType: airShipments.reduce((acc, s) => {
          acc[s.airCargoServiceType || "UNKNOWN"] = (acc[s.airCargoServiceType || "UNKNOWN"] || 0) + 1
          return acc
        }, {}),
        byCargoType: airShipments.reduce((acc, s) => {
          acc[s.cargoType || "GENERAL"] = (acc[s.cargoType || "GENERAL"] || 0) + 1
          return acc
        }, {}),
      },
    })
  } catch (err) {
    next(err)
  }
}

// Helper
async function getAverageDeliveryTime(dateFilter) {
  const delivered = await prisma.shipment.findMany({
    where: {
      ...dateFilter,
      status: "DELIVERED",
      actualDelivery: { not: null },
      actualPickup: { not: null },
    },
    select: { actualPickup: true, actualDelivery: true },
  })

  if (delivered.length === 0) return 0

  const totalHours = delivered.reduce((sum, s) => {
    const diff = new Date(s.actualDelivery).getTime() - new Date(s.actualPickup).getTime()
    return sum + diff / (1000 * 60 * 60)
  }, 0)

  return Number((totalHours / delivered.length).toFixed(2))
}
