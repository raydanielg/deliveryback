import prisma from "../../prisma/client.js"
import { generateTripNumber, calculateSettlement } from "../transport/service.js"
import { createNotification } from "../notifications/controller.js"
import { emitEvent, EVENTS } from "../integrations/event-bus.js"
import { logAction } from "../../middleware/audit-logger.js"

// ============================================================
// TRIP ENGINE — CONTROLLER
// ============================================================
// Manages the full trip lifecycle:
// CREATED → ASSIGNED → ACCEPTED → ARRIVED_PICKUP → CARGO_VERIFIED →
// PICKED_UP → IN_TRANSIT → ARRIVED_DESTINATION → DELIVERED →
// POD_COMPLETE → COMPLETED
//
// Also handles exceptions, reassignment, and settlement.
// ============================================================

// Trip status → Shipment status mapping
const TRIP_TO_SHIPMENT_STATUS = {
  CREATED: "DRIVER_ASSIGNED",
  ASSIGNED: "DRIVER_ASSIGNED",
  ACCEPTED: "ACCEPTED",
  ARRIVED_PICKUP: "OUT_FOR_PICKUP",
  CARGO_VERIFIED: "OUT_FOR_PICKUP",
  PICKED_UP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  ARRIVED_DESTINATION: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  POD_COMPLETE: "DELIVERED",
  COMPLETED: "DELIVERED",
  EXCEPTION: "EXCEPTION",
  CANCELLED: "CANCELLED",
  REASSIGNED: "DRIVER_ASSIGNED",
}

/**
 * Create a trip when a driver is assigned to a shipment.
 * Called internally by the dispatch module.
 */
export async function createTripForAssignment({ shipmentId, driverId, vehicleId, assignmentId, transportRequestId, partnerId, dispatchMode, legNumber = 1, legLabel = null }) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { fromAddress: true, toAddress: true },
  })
  if (!shipment) throw new Error("Shipment not found")

  const trip = await prisma.trip.create({
    data: {
      tripNumber: generateTripNumber(),
      shipmentId,
      transportRequestId: transportRequestId || null,
      assignmentId: assignmentId || null,
      legNumber,
      legLabel: legLabel || `Leg ${legNumber}: ${shipment.fromAddress?.city || "Origin"} → ${shipment.toAddress?.city || "Destination"}`,
      driverId,
      vehicleId: vehicleId || null,
      partnerId: partnerId || null,
      status: "ASSIGNED",
      dispatchMode: dispatchMode || "DIRECT_ASSIGNMENT",
      assignedAt: new Date(),
      originLat: shipment.fromAddress?.latitude || null,
      originLng: shipment.fromAddress?.longitude || null,
      destLat: shipment.toAddress?.latitude || null,
      destLng: shipment.toAddress?.longitude || null,
    },
  })

  // Update transport request status
  if (transportRequestId) {
    await prisma.transportRequest.update({
      where: { id: transportRequestId },
      data: { status: "ASSIGNED", matchedDriverId: driverId, matchedVehicleId: vehicleId || null },
    })
  }

  // Notify driver
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { user: true },
  })
  if (driver?.user) {
    await createNotification(
      driver.user.id,
      "TRIP_ASSIGNED",
      "New Trip Assigned",
      `Trip ${trip.tripNumber} for shipment ${shipment.trackingNumber} has been assigned to you.`,
      { tripId: trip.id, shipmentId, trackingNumber: shipment.trackingNumber },
    )
  }

  // Emit event
  await emitEvent(EVENTS.DRIVER_ASSIGNED, {
    shipment_id: shipmentId,
    tracking_number: shipment.trackingNumber,
    trip_id: trip.id,
    trip_number: trip.tripNumber,
    driver_id: driverId,
    vehicle_id: vehicleId,
  })

  return trip
}

/**
 * GET /api/v1/trips
 * List trips (admin/dispatcher view)
 */
export async function listTrips(req, res, next) {
  try {
    const { status, driverId, shipmentId, page = 1, limit = 20 } = req.query
    const where = {}
    if (status) where.status = status
    if (driverId) where.driverId = driverId
    if (shipmentId) where.shipmentId = shipmentId

    const [trips, total] = await Promise.all([
      prisma.trip.findMany({
        where,
        include: {
          shipment: { select: { id: true, trackingNumber: true, fromAddress: true, toAddress: true, chargeableWeightKg: true, serviceLevel: true } },
          driver: { include: { user: { select: { name: true, phone: true } } } },
          vehicle: { select: { id: true, registrationNo: true, type: true } },
          partner: { select: { id: true, name: true } },
          exceptions: true,
          settlement: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.trip.count({ where }),
    ])

    res.json({ success: true, data: trips, pagination: { page: Number(page), limit: Number(limit), total } })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/trips/:id
 * Get trip details
 */
export async function getTrip(req, res, next) {
  try {
    const { id } = req.params
    const trip = await prisma.trip.findUnique({
      where: { id },
      include: {
        shipment: { include: { fromAddress: true, toAddress: true, packages: true } },
        driver: { include: { user: { select: { name: true, phone: true } } } },
        vehicle: true,
        partner: true,
        exceptions: { orderBy: { reportedAt: "desc" } },
        settlement: true,
        transportRequest: true,
      },
    })

    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })

    res.json({ success: true, data: trip })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/trips/my-trips
 * Get trips for the authenticated driver
 */
export async function getMyTrips(req, res, next) {
  try {
    const { status } = req.query
    const driverId = req.driver.id

    const where = { driverId }
    if (status) where.status = status

    const trips = await prisma.trip.findMany({
      where,
      include: {
        shipment: {
          select: {
            id: true,
            trackingNumber: true,
            fromAddress: true,
            toAddress: true,
            chargeableWeightKg: true,
            serviceLevel: true,
            cargoType: true,
            specialHandling: true,
            otp: true,
            customerName: true,
            customerPhone: true,
          },
        },
        vehicle: { select: { id: true, registrationNo: true, type: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    res.json({ success: true, data: trips })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/trips/active
 * Get the driver's active trip
 */
export async function getMyActiveTrip(req, res, next) {
  try {
    const driverId = req.driver.id

    const trip = await prisma.trip.findFirst({
      where: {
        driverId,
        status: { in: ["ASSIGNED", "ACCEPTED", "ARRIVED_PICKUP", "CARGO_VERIFIED", "PICKED_UP", "IN_TRANSIT", "ARRIVED_DESTINATION", "DELIVERED", "EXCEPTION"] },
      },
      include: {
        shipment: { include: { fromAddress: true, toAddress: true, packages: true } },
        vehicle: true,
        exceptions: { where: { status: "OPEN" }, orderBy: { reportedAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    })

    if (!trip) return res.json({ success: true, data: null })

    res.json({ success: true, data: trip })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/accept
 * Driver accepts the trip
 */
export async function acceptTrip(req, res, next) {
  try {
    const { id } = req.params
    const driverId = req.driver.id

    const trip = await prisma.trip.findUnique({ where: { id }, include: { shipment: true } })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })
    if (trip.driverId !== driverId) return res.status(403).json({ success: false, message: "Not your trip" })
    if (trip.status !== "ASSIGNED" && trip.status !== "CREATED") {
      return res.status(400).json({ success: false, message: `Trip is already ${trip.status}` })
    }

    await prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      })

      await tx.driver.update({
        where: { id: driverId },
        data: { status: "ON_PICKUP" },
      })

      // Update shipment status
      await tx.shipment.update({
        where: { id: trip.shipmentId },
        data: { status: "ACCEPTED" },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: trip.shipmentId,
          event: "TRIP_ACCEPTED",
          status: "ACCEPTED",
          description: `Driver accepted trip ${trip.tripNumber}`,
          createdBy: req.user.id,
        },
      })
    })

    res.json({ success: true, message: "Trip accepted" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/arrive-pickup
 * Driver arrived at pickup location
 */
export async function arriveAtPickup(req, res, next) {
  try {
    const { id } = req.params
    const { latitude, longitude } = req.body
    const driverId = req.driver.id

    const trip = await prisma.trip.findUnique({ where: { id } })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })
    if (trip.driverId !== driverId) return res.status(403).json({ success: false, message: "Not your trip" })
    if (trip.status !== "ACCEPTED") {
      return res.status(400).json({ success: false, message: `Cannot arrive at pickup from status ${trip.status}` })
    }

    await prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id },
        data: { status: "ARRIVED_PICKUP", arrivedPickupAt: new Date() },
      })

      await tx.shipment.update({
        where: { id: trip.shipmentId },
        data: { status: "OUT_FOR_PICKUP" },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: trip.shipmentId,
          event: "ARRIVED_PICKUP",
          status: "OUT_FOR_PICKUP",
          description: "Driver arrived at pickup location",
          latitude: latitude || null,
          longitude: longitude || null,
          createdBy: req.user.id,
        },
      })
    })

    res.json({ success: true, message: "Arrived at pickup" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/verify-cargo
 * Driver verified cargo at pickup
 */
export async function verifyCargo(req, res, next) {
  try {
    const { id } = req.params
    const { notes } = req.body
    const driverId = req.driver.id

    const trip = await prisma.trip.findUnique({ where: { id } })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })
    if (trip.driverId !== driverId) return res.status(403).json({ success: false, message: "Not your trip" })
    if (trip.status !== "ARRIVED_PICKUP") {
      return res.status(400).json({ success: false, message: `Cannot verify cargo from status ${trip.status}` })
    }

    await prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id },
        data: { status: "CARGO_VERIFIED", cargoVerifiedAt: new Date() },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: trip.shipmentId,
          event: "CARGO_VERIFIED",
          status: "OUT_FOR_PICKUP",
          description: notes || "Cargo verified at pickup",
          createdBy: req.user.id,
        },
      })
    })

    res.json({ success: true, message: "Cargo verified" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/pickup
 * Driver picked up cargo — trip starts
 */
export async function pickupTrip(req, res, next) {
  try {
    const { id } = req.params
    const { otp } = req.body
    const driverId = req.driver.id

    const trip = await prisma.trip.findUnique({
      where: { id },
      include: { shipment: true },
    })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })
    if (trip.driverId !== driverId) return res.status(403).json({ success: false, message: "Not your trip" })
    if (trip.status !== "CARGO_VERIFIED") {
      return res.status(400).json({ success: false, message: `Cannot pickup from status ${trip.status}` })
    }

    // Verify OTP if shipment has one
    if (trip.shipment.otp && otp && otp !== trip.shipment.otp) {
      return res.status(400).json({ success: false, message: "Invalid pickup OTP" })
    }

    await prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id },
        data: { status: "PICKED_UP", pickedUpAt: new Date() },
      })

      await tx.driver.update({
        where: { id: driverId },
        data: { status: "ON_DELIVERY" },
      })

      await tx.shipment.update({
        where: { id: trip.shipmentId },
        data: { status: "PICKED_UP", pickupAt: new Date() },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: trip.shipmentId,
          event: "PICKED_UP",
          status: "PICKED_UP",
          description: "Cargo picked up, trip started",
          createdBy: req.user.id,
        },
      })
    })

    res.json({ success: true, message: "Cargo picked up, trip started" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/start-transit
 * Driver starts transit to destination
 */
export async function startTransit(req, res, next) {
  try {
    const { id } = req.params
    const driverId = req.driver.id

    const trip = await prisma.trip.findUnique({ where: { id } })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })
    if (trip.driverId !== driverId) return res.status(403).json({ success: false, message: "Not your trip" })
    if (trip.status !== "PICKED_UP") {
      return res.status(400).json({ success: false, message: `Cannot start transit from status ${trip.status}` })
    }

    await prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id },
        data: { status: "IN_TRANSIT", inTransitAt: new Date() },
      })

      await tx.shipment.update({
        where: { id: trip.shipmentId },
        data: { status: "IN_TRANSIT" },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: trip.shipmentId,
          event: "IN_TRANSIT",
          status: "IN_TRANSIT",
          description: "Trip in transit to destination",
          createdBy: req.user.id,
        },
      })
    })

    res.json({ success: true, message: "Trip in transit" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/arrive-destination
 * Driver arrived at destination
 */
export async function arriveAtDestination(req, res, next) {
  try {
    const { id } = req.params
    const { latitude, longitude } = req.body
    const driverId = req.driver.id

    const trip = await prisma.trip.findUnique({ where: { id } })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })
    if (trip.driverId !== driverId) return res.status(403).json({ success: false, message: "Not your trip" })
    if (trip.status !== "IN_TRANSIT") {
      return res.status(400).json({ success: false, message: `Cannot arrive from status ${trip.status}` })
    }

    await prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id },
        data: { status: "ARRIVED_DESTINATION", arrivedDestAt: new Date() },
      })

      await tx.shipment.update({
        where: { id: trip.shipmentId },
        data: { status: "OUT_FOR_DELIVERY" },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: trip.shipmentId,
          event: "ARRIVED_DESTINATION",
          status: "OUT_FOR_DELIVERY",
          description: "Driver arrived at destination",
          latitude: latitude || null,
          longitude: longitude || null,
          createdBy: req.user.id,
        },
      })
    })

    res.json({ success: true, message: "Arrived at destination" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/deliver
 * Driver delivered cargo
 */
export async function deliverTrip(req, res, next) {
  try {
    const { id } = req.params
    const { otp } = req.body
    const driverId = req.driver.id

    const trip = await prisma.trip.findUnique({
      where: { id },
      include: { shipment: true },
    })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })
    if (trip.driverId !== driverId) return res.status(403).json({ success: false, message: "Not your trip" })
    if (trip.status !== "ARRIVED_DESTINATION") {
      return res.status(400).json({ success: false, message: `Cannot deliver from status ${trip.status}` })
    }

    // Verify delivery OTP if shipment has one
    if (trip.shipment.otp && otp && otp !== trip.shipment.otp) {
      return res.status(400).json({ success: false, message: "Invalid delivery OTP" })
    }

    await prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      })

      await tx.shipment.update({
        where: { id: trip.shipmentId },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: trip.shipmentId,
          event: "DELIVERED",
          status: "DELIVERED",
          description: "Cargo delivered",
          createdBy: req.user.id,
        },
      })
    })

    res.json({ success: true, message: "Cargo delivered, capture POD to complete" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/pod
 * Driver captures proof of delivery
 */
export async function capturePod(req, res, next) {
  try {
    const { id } = req.params
    const { imageUrl, signatureUrl, notes } = req.body
    const driverId = req.driver.id

    const trip = await prisma.trip.findUnique({
      where: { id },
      include: { shipment: true, transportRequest: true },
    })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })
    if (trip.driverId !== driverId) return res.status(403).json({ success: false, message: "Not your trip" })
    if (trip.status !== "DELIVERED") {
      return res.status(400).json({ success: false, message: `Cannot capture POD from status ${trip.status}` })
    }

    // Create settlement
    const customerPrice = Number(trip.shipment.totalAmount || trip.transportRequest?.customerPrice || 0)
    const providerSettlement = Number(trip.transportRequest?.providerSettlement || 0)
    const settlementCalc = calculateSettlement(customerPrice, providerSettlement)

    await prisma.$transaction(async (tx) => {
      // Create settlement
      const settlement = await tx.settlement.create({
        data: {
          tripId: id,
          shipmentId: trip.shipmentId,
          customerPrice: settlementCalc.customerPrice,
          providerSettlement: settlementCalc.providerSettlement,
          xerinMargin: settlementCalc.xerinMargin,
          currency: trip.transportRequest?.currency || trip.shipment.currency || "TZS",
          status: "PENDING",
        },
      })

      // Update trip
      await tx.trip.update({
        where: { id },
        data: {
          status: "POD_COMPLETE",
          podCapturedAt: new Date(),
          podImageUrl: imageUrl || null,
          podSignatureUrl: signatureUrl || null,
          podNotes: notes || null,
          podCapturedById: req.user.id,
          settlementId: settlement.id,
        },
      })

      // Update shipment
      await tx.shipment.update({
        where: { id: trip.shipmentId },
        data: {
          status: "DELIVERED",
          proofImageUrl: imageUrl || null,
          deliveredAt: trip.deliveredAt || new Date(),
        },
      })

      // Update driver status back to available
      await tx.driver.update({
        where: { id: driverId },
        data: { status: "AVAILABLE", totalDeliveries: { increment: 1 } },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: trip.shipmentId,
          event: "POD_COMPLETE",
          status: "DELIVERED",
          description: "Proof of delivery captured",
          createdBy: req.user.id,
        },
      })
    })

    // Emit delivery event
    await emitEvent(EVENTS.SHIPMENT_UPDATED, {
      shipment_id: trip.shipmentId,
      tracking_number: trip.shipment.trackingNumber,
      status: "DELIVERED",
      trip_id: id,
    })

    res.json({ success: true, message: "POD captured, trip completed" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/complete
 * Complete trip (admin or auto after POD)
 */
export async function completeTrip(req, res, next) {
  try {
    const { id } = req.params

    const trip = await prisma.trip.findUnique({ where: { id } })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })
    if (trip.status !== "POD_COMPLETE") {
      return res.status(400).json({ success: false, message: `Cannot complete from status ${trip.status}` })
    }

    await prisma.trip.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date() },
    })

    // Approve settlement if exists
    if (trip.settlementId) {
      await prisma.settlement.update({
        where: { id: trip.settlementId },
        data: { status: "PROCESSING" },
      })
    }

    res.json({ success: true, message: "Trip completed" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/exception
 * Driver or dispatcher raises an exception
 */
export async function raiseException(req, res, next) {
  try {
    const { id } = req.params
    const { type, reason, description, location, latitude, longitude } = req.body

    const trip = await prisma.trip.findUnique({ where: { id } })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })

    const exception = await prisma.$transaction(async (tx) => {
      const exc = await tx.tripException.create({
        data: {
          tripId: id,
          type: type || "OTHER",
          reason,
          description: description || null,
          location: location || null,
          latitude: latitude || null,
          longitude: longitude || null,
          reportedById: req.user.id,
        },
      })

      // Update trip status to EXCEPTION
      await tx.trip.update({
        where: { id },
        data: { status: "EXCEPTION", exceptionType: type, exceptionReason: reason },
      })

      // Update shipment
      await tx.shipment.update({
        where: { id: trip.shipmentId },
        data: { status: "EXCEPTION" },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: trip.shipmentId,
          event: "TRIP_EXCEPTION",
          status: "EXCEPTION",
          description: `Exception: ${reason}`,
          createdBy: req.user.id,
        },
      })

      return exc
    })

    // Notify dispatchers
    const dispatchers = await prisma.user.findMany({
      where: { role: { in: ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"] }, isActive: true },
    })
    for (const d of dispatchers) {
      await createNotification(d.id, "TRIP_EXCEPTION", "Trip Exception Raised", `${type}: ${reason}`, { tripId: id, exceptionId: exception.id })
    }

    res.status(201).json({ success: true, data: exception, message: "Exception raised" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/trips/:id/resolve-exception
 * Dispatcher resolves an exception
 */
export async function resolveException(req, res, next) {
  try {
    const { id } = req.params
    const { exceptionId, resolution, notes } = req.body

    const trip = await prisma.trip.findUnique({ where: { id } })
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found" })

    const updated = await prisma.$transaction(async (tx) => {
      // Resolve exception
      if (exceptionId) {
        await tx.tripException.update({
          where: { id: exceptionId },
          data: {
            status: "RESOLVED",
            resolution,
            resolvedById: req.user.id,
            resolvedAt: new Date(),
            resolutionNotes: notes || null,
          },
        })
      }

      // Handle resolution action
      if (resolution === "REASSIGN") {
        await tx.trip.update({
          where: { id },
          data: { status: "REASSIGNED" },
        })
      } else if (resolution === "CANCEL") {
        await tx.trip.update({
          where: { id },
          data: { status: "CANCELLED" },
        })
        await tx.shipment.update({
          where: { id: trip.shipmentId },
          data: { status: "CANCELLED" },
        })
      } else {
        // RETRY, RESCHEDULE, RETURN_CARGO — resume trip from appropriate state
        await tx.trip.update({
          where: { id },
          data: { status: "IN_TRANSIT", exceptionType: null, exceptionReason: null },
        })
        await tx.shipment.update({
          where: { id: trip.shipmentId },
          data: { status: "IN_TRANSIT" },
        })
      }

      await tx.trackingEvent.create({
        data: {
          shipmentId: trip.shipmentId,
          event: "EXCEPTION_RESOLVED",
          status: "IN_TRANSIT",
          description: `Exception resolved: ${resolution}. ${notes || ""}`,
          createdBy: req.user.id,
        },
      })
    })

    res.json({ success: true, message: "Exception resolved" })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/trips/overview
 * Trip overview for control tower
 */
export async function getTripOverview(req, res, next) {
  try {
    const [
      total,
      active,
      inTransit,
      delivered,
      exceptions,
      completed,
    ] = await Promise.all([
      prisma.trip.count(),
      prisma.trip.count({ where: { status: { in: ["ASSIGNED", "ACCEPTED", "ARRIVED_PICKUP", "CARGO_VERIFIED", "PICKED_UP"] } } }),
      prisma.trip.count({ where: { status: "IN_TRANSIT" } }),
      prisma.trip.count({ where: { status: { in: ["DELIVERED", "POD_COMPLETE"] } } }),
      prisma.trip.count({ where: { status: "EXCEPTION" } }),
      prisma.trip.count({ where: { status: "COMPLETED" } }),
    ])

    // Recent exceptions
    const recentExceptions = await prisma.tripException.findMany({
      where: { status: "OPEN" },
      include: {
        trip: {
          include: {
            shipment: { select: { trackingNumber: true } },
            driver: { include: { user: { select: { name: true } } } },
          },
        },
      },
      orderBy: { reportedAt: "desc" },
      take: 10,
    })

    // Settlements summary
    const settlementsAgg = await prisma.settlement.aggregate({
      where: { status: "PENDING" },
      _sum: { customerPrice: true, providerSettlement: true, xerinMargin: true },
    })

    res.json({
      success: true,
      data: {
        stats: { total, active, inTransit, delivered, exceptions, completed },
        recentExceptions,
        pendingSettlements: {
          customerPrice: Number(settlementsAgg._sum.customerPrice || 0),
          providerSettlement: Number(settlementsAgg._sum.providerSettlement || 0),
          xerinMargin: Number(settlementsAgg._sum.xerinMargin || 0),
        },
      },
    })
  } catch (err) {
    next(err)
  }
}
