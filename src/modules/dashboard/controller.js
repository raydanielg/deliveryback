import prisma from "../../prisma/client.js"

// ============================================================
// ROLE DASHBOARDS — real aggregates, one endpoint per staff role
// ============================================================
// Every figure here is computed from the database at request time. The earlier
// role dashboards read fields the stats endpoints never returned (e.g. `pendingPayments`,
// `receivedToday`), so they silently rendered zeros — these endpoints replace that.

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000 // Africa/Dar_es_Salaam is UTC+3, no DST

// Midnight (East Africa time) `daysAgo` days back, as a real UTC Date.
function startOfDayEAT(daysAgo = 0) {
  const shifted = new Date(Date.now() + EAT_OFFSET_MS)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - EAT_OFFSET_MS - daysAgo * 86400000)
}

const num = (v) => Number(v || 0)
const sumOf = (agg) => num(agg?._sum?.amount)

async function paidSince(since) {
  const agg = await prisma.payment.aggregate({
    where: { status: "PAID", paidAt: { gte: since } },
    _sum: { amount: true },
  })
  return sumOf(agg)
}

// ------------------------------------------------------------
// FINANCE
// ------------------------------------------------------------
export async function getFinanceDashboard(req, res, next) {
  try {
    const today = startOfDayEAT(0)
    const d7 = startOfDayEAT(6)
    const d30 = startOfDayEAT(29)
    const prev30 = startOfDayEAT(59)
    const d14 = startOfDayEAT(13)

    const [
      total, revenueToday, last7d, last30d, prev30d,
      outstandingRows, refundAgg, methodRows, pendingApprovals, pendingApprovalAgg, recentApprovals,
      unpaidInvoices, overdueInvoices, paidInvoicesMonth, modeRows, seriesRows, recentPayments, txCount30d,
    ] = await Promise.all([
      prisma.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
      paidSince(today),
      paidSince(d7),
      paidSince(d30),
      prisma.payment.aggregate({ where: { status: "PAID", paidAt: { gte: prev30, lt: d30 } }, _sum: { amount: true } }),
      // Money still owed on orders that are neither fully paid nor cancelled. Each order is
      // floored at zero: an order that was overpaid must not cancel out what other customers owe.
      prisma.$queryRaw`
        SELECT COALESCE(SUM(GREATEST(o."totalAmount" - COALESCE(p.paid, 0), 0)), 0)::float AS amount,
               COUNT(*) FILTER (WHERE o."totalAmount" - COALESCE(p.paid, 0) > 0)::int AS orders
        FROM orders o
        LEFT JOIN (SELECT "orderId", SUM(amount) AS paid FROM payments WHERE status::text = 'PAID' GROUP BY "orderId") p
          ON p."orderId" = o.id
        WHERE o."paymentStatus"::text IN ('PENDING', 'PARTIAL') AND o.status::text <> 'CANCELLED'`,
      prisma.payment.aggregate({ where: { status: "REFUNDED" }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.payment.groupBy({
        by: ["method"], where: { status: "PAID", paidAt: { gte: d30 } },
        _sum: { amount: true }, _count: { _all: true },
      }),
      prisma.paymentApproval.count({ where: { approvalStatus: "PENDING" } }),
      prisma.paymentApproval.aggregate({ where: { approvalStatus: "PENDING" }, _sum: { totalCharges: true } }),
      prisma.paymentApproval.findMany({
        where: { approvalStatus: "PENDING" },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          id: true, totalCharges: true, createdAt: true,
          shipment: { select: { trackingNumber: true } },
          requestedBy: { select: { name: true } },
        },
      }),
      prisma.invoice.aggregate({ where: { shipmentId: { not: null }, status: "UNPAID" }, _sum: { total: true }, _count: { _all: true } }),
      prisma.invoice.aggregate({ where: { shipmentId: { not: null }, status: "UNPAID", dueDate: { lt: new Date() } }, _sum: { total: true }, _count: { _all: true } }),
      prisma.invoice.aggregate({ where: { shipmentId: { not: null }, status: "PAID", paidAt: { gte: startOfDayEAT(29) } }, _sum: { total: true } }),
      prisma.shipment.groupBy({
        by: ["transportMode"], where: { paymentStatus: "PAID" },
        _sum: { totalAmount: true }, _count: { _all: true },
      }),
      prisma.$queryRaw`
        SELECT to_char(("paidAt" AT TIME ZONE 'Africa/Dar_es_Salaam')::date, 'YYYY-MM-DD') AS day, SUM(amount)::float AS amount
        FROM payments WHERE status::text = 'PAID' AND "paidAt" >= ${d14}
        GROUP BY 1 ORDER BY 1`,
      prisma.payment.findMany({
        where: { status: "PAID" },
        orderBy: { paidAt: "desc" },
        take: 8,
        select: {
          id: true, paymentRef: true, amount: true, currency: true, method: true, paidAt: true,
          order: { select: { orderNumber: true } },
          payer: { select: { name: true } },
        },
      }),
      prisma.payment.count({ where: { status: "PAID", paidAt: { gte: d30 } } }),
    ])

    // Fill missing days so the chart has a continuous axis.
    const byDay = new Map(seriesRows.map((r) => [r.day, num(r.amount)]))
    const series = []
    for (let i = 13; i >= 0; i--) {
      const day = new Date(startOfDayEAT(i).getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10)
      series.push({ date: day, amount: byDay.get(day) || 0 })
    }

    const outstanding = outstandingRows[0] || { amount: 0, orders: 0 }
    const prevRevenue = sumOf(prev30d)
    const trendPct = prevRevenue > 0 ? ((last30d - prevRevenue) / prevRevenue) * 100 : null

    res.json({
      success: true,
      data: {
        currency: "TZS",
        revenue: { total: sumOf(total), today: revenueToday, last7d, last30d, trendPct },
        outstanding: { amount: num(outstanding.amount), orders: num(outstanding.orders) },
        refunds: { amount: sumOf(refundAgg), count: refundAgg._count._all },
        transactions30d: {
          count: txCount30d,
          byMethod: methodRows
            .map((r) => ({ method: r.method, amount: sumOf(r), count: r._count._all }))
            .sort((a, b) => b.amount - a.amount),
        },
        approvals: {
          pending: pendingApprovals,
          pendingAmount: num(pendingApprovalAgg._sum.totalCharges),
          oldest: recentApprovals.map((a) => ({
            id: a.id,
            trackingNumber: a.shipment?.trackingNumber,
            amount: num(a.totalCharges),
            requestedBy: a.requestedBy?.name,
            createdAt: a.createdAt,
          })),
        },
        invoices: {
          unpaidCount: unpaidInvoices._count._all,
          unpaidTotal: num(unpaidInvoices._sum.total),
          overdueCount: overdueInvoices._count._all,
          overdueTotal: num(overdueInvoices._sum.total),
          paidLast30d: num(paidInvoicesMonth._sum.total),
        },
        revenueByMode: modeRows
          .map((r) => ({ mode: r.transportMode, amount: num(r._sum.totalAmount), shipments: r._count._all }))
          .sort((a, b) => b.amount - a.amount),
        series,
        recentPayments: recentPayments.map((p) => ({
          id: p.id, reference: p.paymentRef, amount: num(p.amount), currency: p.currency,
          method: p.method, paidAt: p.paidAt, orderNumber: p.order?.orderNumber, payer: p.payer?.name,
        })),
      },
    })
  } catch (err) { next(err) }
}

// ------------------------------------------------------------
// WAREHOUSE
// ------------------------------------------------------------
const STAGES = {
  receivedDubai: ["RECEIVED_DUBAI"],
  awaitingConsolidation: ["AWAITING_CONSOLIDATION"],
  inTransitToTz: ["DEPARTED_DUBAI"],
  arrivedTanzania: ["ARRIVED_TANZANIA"],
  onShelf: ["ON_SHELF", "WAREHOUSE"],
  readyToRelease: ["READY_FOR_COLLECTION", "READY_FOR_DISPATCH", "INVOICED"],
  outForDelivery: ["OUT_FOR_DELIVERY"],
  onHold: ["ON_HOLD", "OLD_STOCK"],
}

export async function getWarehouseDashboard(req, res, next) {
  try {
    const today = startOfDayEAT(0)
    const allStatuses = Object.values(STAGES).flat()

    const [
      statusRows, boxRows, boxesPackedToday, shelfLocations, shelfBoxes,
      manifestRows, upcomingManifests, pendingApprovals, approvalsList,
      deliveryRows, exceptionsOpen, inventoryHeld, dispatchedToday,
    ] = await Promise.all([
      prisma.shipment.groupBy({ by: ["status"], where: { status: { in: allStatuses } }, _count: { _all: true } }),
      prisma.consolidationBox.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.consolidationBox.count({ where: { createdAt: { gte: today } } }),
      prisma.shelfLocation.count({ where: { isActive: true } }),
      prisma.consolidationBox.count({ where: { status: "SHELVED" } }),
      prisma.tripManifest.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.tripManifest.findMany({
        where: { status: { in: ["PLANNED", "BOXES_ASSIGNED"] }, flightDate: { gte: today } },
        orderBy: { flightDate: "asc" },
        take: 5,
        select: {
          id: true, tripNo: true, airline: true, flightNumber: true, flightDate: true,
          departureAirport: true, arrivalAirport: true, status: true,
          _count: { select: { boxes: true } },
        },
      }),
      prisma.paymentApproval.count({ where: { approvalStatus: "PENDING" } }),
      prisma.paymentApproval.findMany({
        where: { approvalStatus: "PENDING" },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: { id: true, createdAt: true, totalCharges: true, shipment: { select: { trackingNumber: true } } },
      }),
      prisma.deliveryRecord.groupBy({ by: ["status"], where: { createdAt: { gte: today } }, _count: { _all: true } }),
      prisma.shipmentException.count({ where: { status: { in: ["OPEN", "IN_REVIEW", "ESCALATED"] } } }),
      prisma.stationInventory.count({ where: { status: "RECEIVED" } }),
      prisma.stationInventory.count({ where: { dispatchedAt: { gte: today } } }),
    ])

    const statusCount = Object.fromEntries(statusRows.map((r) => [r.status, r._count._all]))
    const stages = Object.fromEntries(
      Object.entries(STAGES).map(([key, list]) => [key, list.reduce((s, st) => s + (statusCount[st] || 0), 0)])
    )
    const boxes = Object.fromEntries(boxRows.map((r) => [r.status, r._count._all]))
    const manifests = Object.fromEntries(manifestRows.map((r) => [r.status, r._count._all]))
    const deliveries = Object.fromEntries(deliveryRows.map((r) => [r.status, r._count._all]))

    res.json({
      success: true,
      data: {
        stages,
        boxes: { byStatus: boxes, packedToday: boxesPackedToday },
        shelves: { locations: shelfLocations, boxesShelved: shelfBoxes },
        manifests: {
          byStatus: manifests,
          upcoming: upcomingManifests.map((m) => ({
            id: m.id, tripNo: m.tripNo, airline: m.airline, flightNumber: m.flightNumber,
            flightDate: m.flightDate, route: `${m.departureAirport} → ${m.arrivalAirport}`,
            status: m.status, boxes: m._count.boxes,
          })),
        },
        release: {
          awaitingApproval: pendingApprovals,
          oldest: approvalsList.map((a) => ({
            id: a.id, trackingNumber: a.shipment?.trackingNumber, amount: num(a.totalCharges), createdAt: a.createdAt,
          })),
        },
        deliveries: {
          assigned: deliveries.ASSIGNED || 0,
          outForDelivery: deliveries.OUT_FOR_DELIVERY || 0,
          delivered: deliveries.DELIVERED || 0,
          failed: deliveries.FAILED_DELIVERY || 0,
        },
        exceptionsOpen,
        stationInventory: { held: inventoryHeld, dispatchedToday },
      },
    })
  } catch (err) { next(err) }
}

// ------------------------------------------------------------
// OPERATIONS / IT
// ------------------------------------------------------------
const AWAITING_ASSIGNMENT = ["BOOKED", "PAYMENT_CONFIRMED", "AWAITING_PICKUP", "PENDING"]
const ACTIVE_TRIP = ["ASSIGNED", "ACCEPTED", "ARRIVED_PICKUP", "CARGO_VERIFIED", "PICKED_UP", "IN_TRANSIT", "ARRIVED_DESTINATION", "DELIVERED"]

export async function getOperationsDashboard(req, res, next) {
  try {
    const today = startOfDayEAT(0)
    const since24h = new Date(Date.now() - 24 * 3600 * 1000)

    // Database round-trip time doubles as a genuine health probe.
    const dbStart = Date.now()
    await prisma.$queryRaw`SELECT 1`
    const dbLatencyMs = Date.now() - dbStart

    const [
      awaitingAssignment, activeTrips, exceptionsOpen, createdToday, deliveredToday, inTransit,
      driverTotal, driversOnline, driversAvailable, driversOnTrip,
      webhookFailed, webhookRetrying, waConnected, waTotal, gatewaysActive, gatewaysTotal, partnersActive,
      roleRows, activeUsers, inactiveUsers, auditRows,
    ] = await Promise.all([
      prisma.shipment.count({ where: { status: { in: AWAITING_ASSIGNMENT }, driverId: null, transportMode: "ROAD" } }),
      prisma.trip.count({ where: { status: { in: ACTIVE_TRIP } } }),
      prisma.shipmentException.count({ where: { status: { in: ["OPEN", "IN_REVIEW", "ESCALATED"] } } }),
      prisma.shipment.count({ where: { createdAt: { gte: today } } }),
      prisma.shipment.count({ where: { status: "DELIVERED", actualDelivery: { gte: today } } }),
      prisma.shipment.count({ where: { status: { in: ["IN_TRANSIT", "ONGOING", "OUT_FOR_DELIVERY", "PICKED_UP"] } } }),
      prisma.driver.count({ where: { isActive: true } }),
      prisma.driver.count({ where: { isActive: true, isOnline: true } }),
      prisma.driver.count({ where: { isActive: true, isOnline: true, status: "AVAILABLE" } }),
      prisma.driver.count({ where: { isActive: true, status: { in: ["ON_TRIP", "ON_PICKUP", "ON_DELIVERY", "ASSIGNED"] } } }),
      prisma.webhookDelivery.count({ where: { status: "FAILED", createdAt: { gte: since24h } } }),
      prisma.webhookDelivery.count({ where: { status: "RETRYING" } }),
      prisma.whatsAppConnection.count({ where: { isActive: true, status: "CONNECTED" } }),
      prisma.whatsAppConnection.count({ where: { isActive: true } }),
      prisma.paymentGateway.count({ where: { isActive: true } }),
      prisma.paymentGateway.count(),
      prisma.partner.count({ where: { status: "ACTIVE" } }),
      prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: false } }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, action: true, entity: true, createdAt: true, user: { select: { name: true, role: true } } },
      }),
    ])

    res.json({
      success: true,
      data: {
        queue: { awaitingAssignment, activeTrips, exceptionsOpen },
        shipments: { createdToday, deliveredToday, inTransit },
        drivers: { total: driverTotal, online: driversOnline, available: driversAvailable, busy: driversOnTrip },
        system: {
          api: { ok: true, uptimeSec: Math.round(process.uptime()) },
          database: { ok: true, latencyMs: dbLatencyMs },
          webhooks: { failed24h: webhookFailed, retrying: webhookRetrying },
          whatsapp: { connected: waConnected, total: waTotal },
          paymentGateways: { active: gatewaysActive, total: gatewaysTotal },
          partners: { active: partnersActive },
        },
        users: {
          active: activeUsers,
          inactive: inactiveUsers,
          byRole: Object.fromEntries(roleRows.map((r) => [r.role, r._count._all])),
        },
        audit: auditRows.map((a) => ({
          id: a.id, action: a.action, entity: a.entity, createdAt: a.createdAt,
          user: a.user?.name || "System", role: a.user?.role || null,
        })),
      },
    })
  } catch (err) { next(err) }
}
