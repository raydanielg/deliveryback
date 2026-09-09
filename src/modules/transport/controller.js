import prisma from "../../prisma/client.js"
import {
  createTransportRequest,
  matchCapacityToShipment,
  calculateTransportRequirement,
} from "./service.js"
import { logAction } from "../../middleware/audit-logger.js"
import { emitEvent, EVENTS } from "../integrations/event-bus.js"

// ============================================================
// TRANSPORT MARKETPLACE — CONTROLLER
// ============================================================

/**
 * GET /api/v1/transport/requests/:shipmentId
 * Get or create transport request for a shipment
 */
export async function getOrCreateTransportRequest(req, res, next) {
  try {
    const { shipmentId } = req.params
    const { dispatchMode } = req.query

    const tr = await createTransportRequest(shipmentId, dispatchMode || "DIRECT_ASSIGNMENT")

    res.json({ success: true, data: tr })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/transport/requests
 * List all transport requests (control tower view)
 */
export async function listTransportRequests(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query
    const where = status ? { status } : {}

    const [requests, total] = await Promise.all([
      prisma.transportRequest.findMany({
        where,
        include: {
          shipment: { select: { id: true, trackingNumber: true, fromAddress: true, toAddress: true, chargeableWeightKg: true } },
          matchedDriver: { select: { id: true, user: { select: { name: true } } } },
          matchedVehicle: { select: { id: true, registrationNo: true, type: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.transportRequest.count({ where }),
    ])

    res.json({ success: true, data: requests, pagination: { page: Number(page), limit: Number(limit), total } })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/transport/requests/:id/capacity-matches
 * Find matching transport capacity for a transport request
 */
export async function getCapacityMatches(req, res, next) {
  try {
    const { id } = req.params
    const matches = await matchCapacityToShipment(id)
    res.json({ success: true, data: matches })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/transport/capacity
 * Publish transport capacity (partner or admin)
 */
export async function publishCapacity(req, res, next) {
  try {
    const {
      partnerId, carrierId, vehicleId,
      vehicleType, capacityKg, volumeM3, registrationNo,
      originCity, originCountry, destCity, destCountry, routeLabel,
      availableFrom, availableTo,
      askingPrice, currency, pricePerKg,
      notes,
    } = req.body

    const capacity = await prisma.transportCapacity.create({
      data: {
        partnerId: partnerId || null,
        carrierId: carrierId || req.user?.carrierId || null,
        vehicleId: vehicleId || null,
        vehicleType,
        capacityKg,
        volumeM3: volumeM3 || null,
        registrationNo: registrationNo || null,
        originCity,
        originCountry: originCountry || "Tanzania",
        destCity,
        destCountry: destCountry || "Tanzania",
        routeLabel: routeLabel || `${originCity} → ${destCity}`,
        availableFrom: new Date(availableFrom),
        availableTo: new Date(availableTo),
        askingPrice: askingPrice || null,
        currency: currency || "TZS",
        pricePerKg: pricePerKg || false,
        notes: notes || null,
      },
    })

    await logAction({
      userId: req.user.id,
      action: "PUBLISH_TRANSPORT_CAPACITY",
      entity: "transport_capacity",
      entityId: capacity.id,
      changes: req.body,
      req,
    })

    res.status(201).json({ success: true, data: capacity, message: "Transport capacity published" })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/transport/capacity
 * List available transport capacity
 */
export async function listCapacity(req, res, next) {
  try {
    const { status, originCity, destCity, vehicleType, page = 1, limit = 20 } = req.query
    const where = {}
    if (status) where.status = status
    if (originCity) where.originCity = { equals: originCity, mode: "insensitive" }
    if (destCity) where.destCity = { equals: destCity, mode: "insensitive" }
    if (vehicleType) where.vehicleType = vehicleType

    const [capacities, total] = await Promise.all([
      prisma.transportCapacity.findMany({
        where,
        include: {
          partner: { select: { id: true, name: true, health: true } },
          carrier: { select: { id: true, name: true } },
          vehicle: { select: { id: true, registrationNo: true, type: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.transportCapacity.count({ where }),
    ])

    res.json({ success: true, data: capacities, pagination: { page: Number(page), limit: Number(limit), total } })
  } catch (err) {
    next(err)
  }
}

/**
 * PATCH /api/v1/transport/capacity/:id
 * Update capacity status (cancel, etc.)
 */
export async function updateCapacity(req, res, next) {
  try {
    const { id } = req.params
    const { status, notes } = req.body

    const capacity = await prisma.transportCapacity.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
      },
    })

    res.json({ success: true, data: capacity })
  } catch (err) {
    next(err)
  }
}

/**
 * DELETE /api/v1/transport/capacity/:id
 * Cancel transport capacity
 */
export async function cancelCapacity(req, res, next) {
  try {
    const { id } = req.params

    const capacity = await prisma.transportCapacity.update({
      where: { id },
      data: { status: "CANCELLED" },
    })

    await logAction({
      userId: req.user.id,
      action: "CANCEL_TRANSPORT_CAPACITY",
      entity: "transport_capacity",
      entityId: id,
      req,
    })

    res.json({ success: true, message: "Transport capacity cancelled" })
  } catch (err) {
    next(err)
  }
}
