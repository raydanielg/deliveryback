import prisma from "../../prisma/client.js"
import { checkDriverEligibility, findEligibleDrivers } from "./eligibility.js"
import { createNotification } from "../notifications/controller.js"
import { emitEvent, EVENTS } from "../integrations/event-bus.js"
import { logAction } from "../../middleware/audit-logger.js"
import { createTripForAssignment } from "../trips/controller.js"
import { createTransportRequest } from "../transport/service.js"

// ============================================================
// DISPATCH CONTROLLER
// ============================================================
// Supports both DIRECT_ASSIGNMENT and OPEN_ORDER (driver marketplace).
// Uses database transactions and row locking to prevent race conditions
// where two drivers could accept the same shipment.
// ============================================================

// In-memory dispatch configuration (persisted via settings/business)
let dispatchConfig = {
  autoAssignmentEnabled: false,
  driverMarketplaceEnabled: true,
  defaultOfferRadiusKm: 50,
  offerTimeoutMinutes: 5,
  maxOffersPerShipment: 10,
  assignmentRetryIntervalMinutes: 2,
  maxAssignmentAttempts: 3,
  capacityTolerancePercent: 0,
  performanceWeight: 0.3,
  locationWeight: 0.4,
}

export function getDispatchConfig() {
  return { ...dispatchConfig }
}

export function updateDispatchConfig(updates) {
  for (const [key, value] of Object.entries(updates)) {
    if (key in dispatchConfig) {
      dispatchConfig[key] = typeof dispatchConfig[key] === "boolean" ? Boolean(value)
        : typeof dispatchConfig[key] === "number" ? Number(value)
        : value
    }
  }
  return dispatchConfig
}

// ============================================================
// 1. OPEN SHIPMENT TO DRIVER MARKETPLACE
// ============================================================
// Converts a shipment to OPEN_ORDER mode, finds eligible drivers,
// creates OrderOffer records for each, and sends notifications.

export async function openToDrivers(req, res, next) {
  try {
    const { id } = req.params
    const { radiusKm, maxDrivers, offerTimeoutMinutes } = req.body || {}

    const shipment = await prisma.shipment.findUnique({
      where: { id },
      include: { fromAddress: true, toAddress: true, packages: true },
    })
    if (!shipment) {
      return res.status(404).json({ success: false, message: "Shipment not found" })
    }

    // Shipment must be in a pre-assignment state
    const assignableStatuses = ["BOOKED", "PAYMENT_CONFIRMED", "AWAITING_PICKUP", "PENDING"]
    if (!assignableStatuses.includes(shipment.status)) {
      return res.status(400).json({
        success: false,
        message: `Shipment cannot be opened to drivers in ${shipment.status} status`,
      })
    }

    // Already has an active offer?
    const existingOffers = await prisma.orderOffer.count({
      where: { shipmentId: id, status: "PENDING" },
    })
    if (existingOffers > 0) {
      return res.status(400).json({
        success: false,
        message: "Shipment already has pending driver offers. Cancel existing offers first.",
      })
    }

    // Update shipment dispatch mode
    await prisma.shipment.update({
      where: { id },
      data: {
        dispatchMode: "OPEN_ORDER",
        dispatchOfferRadius: radiusKm || dispatchConfig.defaultOfferRadiusKm,
      },
    })

    // Find eligible drivers
    const eligibleDrivers = await findEligibleDrivers(id, {
      radiusKm: radiusKm || dispatchConfig.defaultOfferRadiusKm,
      maxDrivers: maxDrivers || dispatchConfig.maxOffersPerShipment,
      onlineOnly: true,
    })

    if (eligibleDrivers.length === 0) {
      return res.json({
        success: true,
        message: "Shipment opened to marketplace but no eligible drivers found",
        data: { shipmentId: id, offersCreated: 0, eligibleDrivers: [] },
      })
    }

    // Create order offers for each eligible driver
    const timeoutMin = offerTimeoutMinutes || dispatchConfig.offerTimeoutMinutes
    const expiresAt = new Date(Date.now() + timeoutMin * 60 * 1000)

    const offers = await Promise.all(
      eligibleDrivers.map((driver) =>
        prisma.orderOffer.create({
          data: {
            shipmentId: id,
            driverId: driver.driverId,
            status: "PENDING",
            offerRadius: radiusKm || dispatchConfig.defaultOfferRadiusKm,
            offerExpiresAt: expiresAt,
            eligibilityScore: driver.score,
            rankLabel: driver.rankLabel,
            estimatedDistanceKm: driver.pickupDistanceKm,
          },
        }).then((offer) => {
          // Send push notification to driver
          createNotification(
            driver.driverId,
            "OPEN_ORDER",
            "New Order Available",
            `Shipment ${shipment.trackingNumber}: ${shipment.fromAddress?.city || ""} → ${shipment.toAddress?.city || ""}`,
            { shipmentId: id, offerId: offer.id }
          ).catch(() => {}) // non-blocking
          return offer
        })
      )
    )

    // Emit event for real-time updates
    await emitEvent(EVENTS.SHIPMENT_UPDATED, {
      shipment_id: id,
      tracking_number: shipment.trackingNumber,
      dispatch_mode: "OPEN_ORDER",
      offers_created: offers.length,
    }, shipment.partnerId ? { partnerId: shipment.partnerId } : {})

    res.json({
      success: true,
      message: `Shipment opened to ${offers.length} eligible driver(s)`,
      data: {
        shipmentId: id,
        offersCreated: offers.length,
        eligibleDrivers: eligibleDrivers.map((d) => ({
          driverId: d.driverId,
          driverName: d.driverName,
          score: d.score,
          rankLabel: d.rankLabel,
          pickupDistanceKm: d.pickupDistanceKm?.toFixed(1),
        })),
      },
    })
  } catch (err) {
    next(err)
  }
}

// ============================================================
// 2. DRIVER ACCEPTS AN ORDER (RACE CONDITION PROTECTED)
// ============================================================
// Uses a database transaction with row-level locking to ensure
// two drivers cannot accept the same shipment simultaneously.

export async function acceptOrder(req, res, next) {
  try {
    const { offerId } = req.params
    const driverId = req.driver?.id // set by driverAuth middleware

    if (!driverId) {
      return res.status(403).json({ success: false, message: "Driver authentication required" })
    }

    // Use a transaction with row locking to prevent race conditions
    const result = await prisma.$transaction(async (tx) => {
      // Lock the order offer row for update
      const offer = await tx.$queryRaw`
        SELECT * FROM order_offers WHERE id = ${offerId} FOR UPDATE
      `
      const offerRow = Array.isArray(offer) ? offer[0] : offer

      if (!offerRow) {
        throw new Error("Order offer not found")
      }

      if (offerRow.status !== "PENDING") {
        throw new Error(`Order is no longer available (status: ${offerRow.status})`)
      }

      // Check if offer has expired
      // Prisma columns are camelCase by default (no @map on this model) — reading
      // snake_case keys off a $queryRaw result silently returns undefined, which broke
      // every check below: expiry was never actually enforced (Invalid Date comparisons
      // are always false), and the ownership check always threw "This offer does not
      // belong to you" for every driver, on every order, unconditionally.
      if (new Date(offerRow.offerExpiresAt) < new Date()) {
        await tx.orderOffer.update({
          where: { id: offerId },
          data: { status: "EXPIRED", expiredAt: new Date() },
        })
        throw new Error("Order offer has expired")
      }

      // Verify this offer belongs to this driver
      if (offerRow.driverId !== driverId) {
        throw new Error("This offer does not belong to you")
      }

      // Lock the shipment row to prevent concurrent acceptance
      const shipmentLock = await tx.$queryRaw`
        SELECT * FROM shipments WHERE id = ${offerRow.shipmentId} FOR UPDATE
      `
      const shipment = Array.isArray(shipmentLock) ? shipmentLock[0] : shipmentLock

      if (!shipment) {
        throw new Error("Shipment not found")
      }

      // Check if shipment already has a driver assigned
      if (shipment.driverId) {
        // Mark this offer as superseded
        await tx.orderOffer.update({
          where: { id: offerId },
          data: { status: "SUPERSEDED" },
        })
        throw new Error("Order already assigned to another driver")
      }

      // Re-check eligibility inside the transaction
      const eligibility = await checkDriverEligibility(driverId, offerRow.shipmentId)
      if (!eligibility.eligible) {
        await tx.orderOffer.update({
          where: { id: offerId },
          data: { status: "REJECTED", rejectionReason: eligibility.reasons.join("; ") },
        })
        throw new Error(`Eligibility check failed: ${eligibility.reasons.join(", ")}`)
      }

      // Accept the offer
      await tx.orderOffer.update({
        where: { id: offerId },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
        },
      })

      // Assign the driver to the shipment
      const assignment = await tx.assignment.create({
        data: {
          shipmentId: offerRow.shipmentId,
          driverId,
          vehicleId: eligibility.vehicle?.id || null,
          // Assignment.assignedById is a FK to User.id, not Driver.id — `driverId` here is
          // req.driver.id (the Driver record's own id), so this violated the FK constraint
          // on every marketplace acceptance. req.user.id is the actual User.id.
          assignedById: req.user.id, // self-assigned via marketplace
          status: "ACCEPTED",
          acceptedAt: new Date(),
        },
      })

      // Update shipment
      await tx.shipment.update({
        where: { id: offerRow.shipmentId },
        data: {
          driverId,
          vehicleId: eligibility.vehicle?.id || null,
          status: "DRIVER_ASSIGNED",
          dispatchAcceptedAt: new Date(),
        },
      })

      // Update driver status
      await tx.driver.update({
        where: { id: driverId },
        data: { status: "ASSIGNED" },
      })

      // Cancel all other pending offers for this shipment
      await tx.orderOffer.updateMany({
        where: {
          shipmentId: offerRow.shipmentId,
          status: "PENDING",
          id: { not: offerId },
        },
        data: { status: "SUPERSEDED" },
      })

      // Create tracking event
      await tx.trackingEvent.create({
        data: {
          shipmentId: offerRow.shipmentId,
          event: "DRIVER_ACCEPTED",
          status: "DRIVER_ASSIGNED",
          description: "Driver accepted order from marketplace",
          createdBy: driverId,
        },
      })

      return { assignment, shipmentId: offerRow.shipmentId, trackingNumber: shipment.trackingNumber, vehicleId: eligibility.vehicle?.id || null }
    }, {
      timeout: 10000, // 10 second timeout for the transaction
      isolationLevel: "Serializable",
    })

    // Send notifications (outside transaction)
    const shipment = await prisma.shipment.findUnique({
      where: { id: result.shipmentId },
      include: { fromAddress: true, toAddress: true },
    })

    // Notify dispatcher
    const dispatchers = await prisma.user.findMany({
      where: { role: { in: ["DISPATCHER", "OPERATIONS_MANAGER", "SUPER_ADMIN"] } },
      select: { id: true },
    })
    for (const d of dispatchers) {
      createNotification(
        d.id,
        "ORDER_ACCEPTED",
        "Driver Accepted Order",
        `Shipment ${result.trackingNumber} has been accepted by a driver`,
        { shipmentId: result.shipmentId }
      ).catch(() => {})
    }

    // Emit event
    await emitEvent(EVENTS.DRIVER_ASSIGNED, {
      shipment_id: result.shipmentId,
      tracking_number: result.trackingNumber,
      driver_id: driverId,
      assignment_mode: "OPEN_ORDER",
    }, shipment?.partnerId ? { partnerId: shipment.partnerId } : {})

    // Create transport request + trip for this assignment
    try {
      const tr = await createTransportRequest(result.shipmentId, "OPEN_ORDER")
      await createTripForAssignment({
        shipmentId: result.shipmentId,
        driverId,
        // `eligibility` was computed inside the $transaction closure above and is out of
        // scope here — referencing it directly threw a ReferenceError on every marketplace
        // acceptance, silently swallowed by the catch below, so no Trip was ever created
        // even though the API reported success. Carried through via `result` instead.
        vehicleId: result.vehicleId,
        assignmentId: result.assignment.id,
        transportRequestId: tr.id,
        dispatchMode: "OPEN_ORDER",
      })
    } catch (tripErr) {
      console.error("Failed to create trip:", tripErr)
      // Trip creation failure should not fail the acceptance
    }

    res.json({
      success: true,
      message: "Order accepted successfully",
      data: result.assignment,
    })
  } catch (err) {
    // Handle race condition gracefully
    if (err.message.includes("Order already assigned") || err.message.includes("no longer available")) {
      return res.status(409).json({ success: false, message: err.message })
    }
    if (err.message.includes("expired")) {
      return res.status(410).json({ success: false, message: err.message })
    }
    if (err.message.includes("Eligibility")) {
      return res.status(400).json({ success: false, message: err.message })
    }
    next(err)
  }
}

// ============================================================
// 3. DRIVER REJECTS AN ORDER
// ============================================================

export async function rejectOrder(req, res, next) {
  try {
    const { offerId } = req.params
    const { reason, notes } = req.body || {}
    const driverId = req.driver?.id

    if (!driverId) {
      return res.status(403).json({ success: false, message: "Driver authentication required" })
    }

    const offer = await prisma.orderOffer.findUnique({
      where: { id: offerId },
    })
    if (!offer) {
      return res.status(404).json({ success: false, message: "Order offer not found" })
    }
    if (offer.driverId !== driverId) {
      return res.status(403).json({ success: false, message: "This offer does not belong to you" })
    }
    if (offer.status !== "PENDING") {
      return res.status(400).json({ success: false, message: `Offer is already ${offer.status}` })
    }

    await prisma.$transaction([
      prisma.orderOffer.update({
        where: { id: offerId },
        data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: reason || "OTHER" },
      }),
      prisma.driverRejection.create({
        data: {
          shipmentId: offer.shipmentId,
          driverId,
          reason: reason || "OTHER",
          notes: notes || null,
        },
      }),
    ])

    res.json({ success: true, message: "Order rejected" })
  } catch (err) {
    next(err)
  }
}

// ============================================================
// 4. GET AVAILABLE ORDERS FOR DRIVER
// ============================================================
// Returns only orders the driver is eligible to accept.
// Does not expose unnecessary customer PII before acceptance.

export async function getAvailableOrders(req, res, next) {
  try {
    const driverId = req.driver?.id
    if (!driverId) {
      return res.status(403).json({ success: false, message: "Driver authentication required" })
    }

    // Find all pending offers for this driver that haven't expired
    const offers = await prisma.orderOffer.findMany({
      where: {
        driverId,
        status: "PENDING",
        offerExpiresAt: { gt: new Date() },
      },
      include: {
        shipment: {
          include: {
            fromAddress: true,
            toAddress: { select: { city: true, country: true } }, // limited PII
            packages: { select: { weightKg: true, description: true, type: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    // Format for driver app — no customer PII
    const orders = offers.map((offer) => {
      const s = offer.shipment
      return {
        offerId: offer.id,
        shipmentId: s.id,
        trackingNumber: s.trackingNumber,
        status: s.status,
        fromCity: s.fromAddress?.city,
        fromCountry: s.fromAddress?.country,
        toCity: s.toAddress?.city,
        toCountry: s.toAddress?.country,
        fromAddress: s.fromAddress?.address,
        cargoType: s.cargoType || "GENERAL",
        transportMode: s.transportMode,
        serviceLevel: s.serviceLevel,
        weightKg: Number(s.chargeableWeightKg),
        packageCount: s.packages.length,
        packages: s.packages.map((p) => ({
          type: p.type,
          weightKg: Number(p.weightKg),
          description: p.description,
        })),
        specialHandling: s.specialHandling,
        estimatedPickup: s.estimatedPickup,
        estimatedDelivery: s.estimatedDelivery,
        vehicleCategory: s.vehicleCategory,
        description: s.description,
        estimatedDistanceKm: offer.estimatedDistanceKm,
        estimatedEarnings: offer.estimatedEarnings ? Number(offer.estimatedEarnings) : null,
        rankLabel: offer.rankLabel,
        eligibilityScore: offer.eligibilityScore,
        offerExpiresAt: offer.offerExpiresAt,
        createdAt: offer.createdAt,
      }
    })

    res.json({ success: true, data: orders })
  } catch (err) {
    next(err)
  }
}

// ============================================================
// 5. DRIVER GO ONLINE / OFFLINE
// ============================================================

export async function goOnline(req, res, next) {
  try {
    const driverId = req.driver?.id
    if (!driverId) {
      return res.status(403).json({ success: false, message: "Driver authentication required" })
    }

    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: {
        isOnline: true,
        lastOnlineAt: new Date(),
        status: "AVAILABLE",
      },
      select: { id: true, isOnline: true, status: true },
    })

    res.json({ success: true, message: "You are now online", data: driver })
  } catch (err) {
    next(err)
  }
}

export async function goOffline(req, res, next) {
  try {
    const driverId = req.driver?.id
    if (!driverId) {
      return res.status(403).json({ success: false, message: "Driver authentication required" })
    }

    // Check if driver has active assignments
    const activeAssignments = await prisma.assignment.count({
      where: {
        driverId,
        status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"] },
      },
    })

    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: {
        isOnline: false,
        status: activeAssignments > 0 ? "ASSIGNED" : "OFFLINE",
      },
      select: { id: true, isOnline: true, status: true },
    })

    res.json({
      success: true,
      message: activeAssignments > 0
        ? "You are offline but existing assignments will continue"
        : "You are now offline",
      data: driver,
    })
  } catch (err) {
    next(err)
  }
}

// ============================================================
// 6. AUTO ASSIGNMENT
// ============================================================
// System automatically finds the best eligible driver + vehicle.

export async function autoAssign(req, res, next) {
  try {
    const { id } = req.params

    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) {
      return res.status(404).json({ success: false, message: "Shipment not found" })
    }
    if (shipment.driverId) {
      return res.status(400).json({ success: false, message: "Shipment already has a driver assigned" })
    }

    // Find best eligible driver
    const eligibleDrivers = await findEligibleDrivers(id, {
      radiusKm: shipment.dispatchOfferRadius || dispatchConfig.defaultOfferRadiusKm,
      maxDrivers: 1,
      onlineOnly: false, // auto-assign can use offline drivers too
    })

    if (eligibleDrivers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No eligible drivers found for auto-assignment",
      })
    }

    const bestDriver = eligibleDrivers[0]

    // Use the existing assignShipment function
    const assignment = await prisma.$transaction(async (tx) => {
      const assignment = await tx.assignment.create({
        data: {
          shipmentId: id,
          driverId: bestDriver.driverId,
          vehicleId: bestDriver.vehicle?.id || null,
          assignedById: req.user.id,
          status: "ASSIGNED",
        },
      })

      await tx.shipment.update({
        where: { id },
        data: {
          driverId: bestDriver.driverId,
          vehicleId: bestDriver.vehicle?.id || null,
          status: "DRIVER_ASSIGNED",
          dispatchMode: "AUTO_ASSIGNMENT",
          dispatchAssignedAt: new Date(),
        },
      })

      await tx.driver.update({
        where: { id: bestDriver.driverId },
        data: { status: "ASSIGNED" },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: id,
          event: "DRIVER_AUTO_ASSIGNED",
          status: "DRIVER_ASSIGNED",
          description: `Auto-assigned to ${bestDriver.driverName} (score: ${bestDriver.score})`,
          createdBy: req.user.id,
        },
      })

      return assignment
    })

    // Notify driver
    createNotification(
      bestDriver.driverId,
      "AUTO_ASSIGNMENT",
      "New Assignment",
      `Shipment ${shipment.trackingNumber} has been assigned to you`,
      { shipmentId: id }
    ).catch(() => {})

    // Create transport request + trip
    try {
      const tr = await createTransportRequest(id, "AUTO_ASSIGNMENT")
      await createTripForAssignment({
        shipmentId: id,
        driverId: bestDriver.driverId,
        vehicleId: bestDriver.vehicle?.id || null,
        assignmentId: assignment.id,
        transportRequestId: tr.id,
        dispatchMode: "AUTO_ASSIGNMENT",
      })
    } catch (tripErr) {
      console.error("Failed to create trip for auto-assign:", tripErr)
    }

    res.json({
      success: true,
      message: `Auto-assigned to ${bestDriver.driverName}`,
      data: {
        assignment,
        driver: {
          driverId: bestDriver.driverId,
          driverName: bestDriver.driverName,
          score: bestDriver.score,
          rankLabel: bestDriver.rankLabel,
        },
      },
    })
  } catch (err) {
    next(err)
  }
}

// ============================================================
// 7. CANCEL OFFER / CLOSE ORDER
// ============================================================

export async function cancelOffers(req, res, next) {
  try {
    const { id } = req.params

    const result = await prisma.orderOffer.updateMany({
      where: { shipmentId: id, status: "PENDING" },
      data: { status: "CANCELLED" },
    })

    // Reset dispatch mode if no offers were accepted
    const hasAccepted = await prisma.orderOffer.count({
      where: { shipmentId: id, status: "ACCEPTED" },
    })
    if (!hasAccepted) {
      await prisma.shipment.update({
        where: { id },
        data: { dispatchMode: "DIRECT_ASSIGNMENT", dispatchOfferRadius: null },
      })
    }

    res.json({
      success: true,
      message: `${result.count} offer(s) cancelled`,
      data: { cancelledCount: result.count },
    })
  } catch (err) {
    next(err)
  }
}

// ============================================================
// 8. GET DISPATCH OVERVIEW (for control tower)
// ============================================================

export async function getDispatchOverview(req, res, next) {
  try {
    const [
      unassigned,
      openOrders,
      offered,
      accepted,
      assigned,
      inTransit,
      delivered,
      failed,
    ] = await Promise.all([
      prisma.shipment.count({
        where: { status: { in: ["BOOKED", "PAYMENT_CONFIRMED", "PENDING"] }, driverId: null },
      }),
      prisma.shipment.count({
        where: { dispatchMode: "OPEN_ORDER", driverId: null },
      }),
      prisma.orderOffer.count({ where: { status: "PENDING" } }),
      prisma.orderOffer.count({ where: { status: "ACCEPTED" } }),
      prisma.shipment.count({ where: { status: "DRIVER_ASSIGNED" } }),
      prisma.shipment.count({
        where: { status: { in: ["PICKED_UP", "IN_TRANSIT", "ONGOING", "OUT_FOR_DELIVERY"] } },
      }),
      prisma.shipment.count({ where: { status: "DELIVERED" } }),
      prisma.shipment.count({ where: { status: { in: ["FAILED", "DELIVERY_FAILED", "RETURNED"] } } }),
    ])

    // Get active offers with driver info
    const activeOffers = await prisma.orderOffer.findMany({
      where: { status: "PENDING" },
      include: {
        shipment: {
          select: {
            id: true,
            trackingNumber: true,
            status: true,
            fromAddress: { select: { city: true, country: true } },
            toAddress: { select: { city: true, country: true } },
            chargeableWeightKg: true,
            serviceLevel: true,
          },
        },
        driver: {
          select: {
            id: true,
            user: { select: { name: true, phone: true } },
            rating: true,
            currentLatitude: true,
            currentLongitude: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    // Get unassigned shipments
    const unassignedShipments = await prisma.shipment.findMany({
      where: {
        status: { in: ["BOOKED", "PAYMENT_CONFIRMED", "AWAITING_PICKUP", "PENDING"] },
        driverId: null,
      },
      include: {
        fromAddress: { select: { city: true, country: true } },
        toAddress: { select: { city: true, country: true } },
        packages: { select: { weightKg: true, type: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    // Get assigned shipments with driver/vehicle info
    const assignedShipments = await prisma.shipment.findMany({
      where: {
        status: { in: ["DRIVER_ASSIGNED", "ACCEPTED", "OUT_FOR_PICKUP"] },
      },
      include: {
        driver: {
          select: {
            id: true,
            user: { select: { name: true, phone: true } },
            status: true,
            currentLatitude: true,
            currentLongitude: true,
            rating: true,
          },
        },
        vehicle: { select: { id: true, registrationNo: true, type: true, capacityKg: true } },
        fromAddress: { select: { city: true, country: true } },
        toAddress: { select: { city: true, country: true } },
      },
      orderBy: { dispatchAssignedAt: "desc" },
      take: 50,
    })

    res.json({
      success: true,
      data: {
        stats: {
          unassigned,
          openOrders,
          offered,
          accepted,
          assigned,
          inTransit,
          delivered,
          failed,
        },
        activeOffers,
        unassignedShipments,
        assignedShipments,
      },
    })
  } catch (err) {
    next(err)
  }
}

// ============================================================
// 9. GET ELIGIBLE DRIVERS FOR A SHIPMENT (dispatcher view)
// ============================================================

export async function getEligibleDriversForShipment(req, res, next) {
  try {
    const { id } = req.params
    const { radiusKm, maxDrivers } = req.query

    const eligibleDrivers = await findEligibleDrivers(id, {
      radiusKm: radiusKm ? parseInt(radiusKm) : dispatchConfig.defaultOfferRadiusKm,
      maxDrivers: maxDrivers ? parseInt(maxDrivers) : 50,
      onlineOnly: false, // dispatcher can see all eligible drivers
    })

    res.json({
      success: true,
      data: eligibleDrivers,
    })
  } catch (err) {
    next(err)
  }
}

// ============================================================
// 10. REASSIGN SHIPMENT
// ============================================================

export async function reassignShipment(req, res, next) {
  try {
    const { id } = req.params
    const { driverId, vehicleId, reason } = req.body

    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) {
      return res.status(404).json({ success: false, message: "Shipment not found" })
    }
    if (!shipment.driverId) {
      return res.status(400).json({ success: false, message: "Shipment has no driver to reassign" })
    }

    // Mark old assignment as CANCELLED
    await prisma.assignment.updateMany({
      where: {
        shipmentId: id,
        status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"] },
      },
      data: { status: "CANCELLED", completedAt: new Date() },
    })

    // Set old driver back to AVAILABLE
    await prisma.driver.update({
      where: { id: shipment.driverId },
      data: { status: "AVAILABLE" },
    })

    // Set old vehicle back to AVAILABLE
    if (shipment.vehicleId) {
      await prisma.vehicle.update({
        where: { id: shipment.vehicleId },
        data: { status: "AVAILABLE" },
      })
    }

    // Validate new driver
    const eligibility = await checkDriverEligibility(driverId, id)
    if (!eligibility.eligible) {
      return res.status(400).json({
        success: false,
        message: `Cannot reassign: ${eligibility.reasons.join(", ")}`,
      })
    }

    // Create new assignment
    const assignment = await prisma.$transaction(async (tx) => {
      const assignment = await tx.assignment.create({
        data: {
          shipmentId: id,
          driverId,
          vehicleId: vehicleId || eligibility.vehicle?.id || null,
          assignedById: req.user.id,
          status: "ASSIGNED",
        },
      })

      await tx.shipment.update({
        where: { id },
        data: {
          driverId,
          vehicleId: vehicleId || eligibility.vehicle?.id || null,
          dispatchAssignedAt: new Date(),
        },
      })

      await tx.driver.update({
        where: { id: driverId },
        data: { status: "ASSIGNED" },
      })

      await tx.trackingEvent.create({
        data: {
          shipmentId: id,
          event: "DRIVER_REASSIGNED",
          status: shipment.status,
          description: `Reassigned to new driver. Reason: ${reason || "Not specified"}`,
          createdBy: req.user.id,
        },
      })

      return assignment
    })

    // Notify old driver
    createNotification(
      shipment.driverId,
      "REASSIGNMENT",
      "Assignment Cancelled",
      `Shipment ${shipment.trackingNumber} has been reassigned to another driver`,
      { shipmentId: id }
    ).catch(() => {})

    // Notify new driver
    createNotification(
      driverId,
      "NEW_ASSIGNMENT",
      "New Assignment",
      `Shipment ${shipment.trackingNumber} has been assigned to you`,
      { shipmentId: id }
    ).catch(() => {})

    // Emit event
    await emitEvent(EVENTS.DRIVER_REASSIGNED, {
      shipment_id: id,
      tracking_number: shipment.trackingNumber,
      old_driver_id: shipment.driverId,
      new_driver_id: driverId,
      reason,
    }, shipment.partnerId ? { partnerId: shipment.partnerId } : {})

    // Audit log
    await logAction({
      userId: req.user.id,
      action: "DRIVER_REASSIGNMENT",
      entity: "shipment",
      entityId: id,
      changes: { oldDriverId: shipment.driverId, newDriverId: driverId, reason },
      req,
    })

    // Create new trip for reassigned driver
    try {
      // Mark old trips as REASSIGNED
      await prisma.trip.updateMany({
        where: { shipmentId: id, status: { in: ["ASSIGNED", "ACCEPTED", "ARRIVED_PICKUP", "CARGO_VERIFIED", "PICKED_UP", "IN_TRANSIT", "EXCEPTION"] } },
        data: { status: "REASSIGNED" },
      })

      const tr = await createTransportRequest(id, "DIRECT_ASSIGNMENT")
      await createTripForAssignment({
        shipmentId: id,
        driverId,
        vehicleId: vehicleId || eligibility.vehicle?.id || null,
        assignmentId: assignment.id,
        transportRequestId: tr.id,
        dispatchMode: "DIRECT_ASSIGNMENT",
      })
    } catch (tripErr) {
      console.error("Failed to create trip for reassignment:", tripErr)
    }

    res.json({
      success: true,
      message: "Shipment reassigned successfully",
      data: assignment,
    })
  } catch (err) {
    next(err)
  }
}

// ============================================================
// 11. GET ASSIGNMENT HISTORY FOR A SHIPMENT
// ============================================================

export async function getAssignmentHistory(req, res, next) {
  try {
    const { id } = req.params

    const history = await prisma.assignment.findMany({
      where: { shipmentId: id },
      include: {
        driver: {
          select: {
            id: true,
            user: { select: { name: true, phone: true } },
          },
        },
        vehicle: { select: { id: true, registrationNo: true, type: true } },
        assignedBy: { select: { id: true, name: true } },
      },
      orderBy: { assignedAt: "desc" },
    })

    res.json({ success: true, data: history })
  } catch (err) {
    next(err)
  }
}

// ============================================================
// 12. DISPATCH ANALYTICS
// ============================================================

export async function getDispatchAnalytics(req, res, next) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const [
      totalOffers,
      acceptedOffers,
      rejectedOffers,
      expiredOffers,
      totalAssignments,
      autoAssignments,
      reassignments,
      activeDrivers,
      onlineDrivers,
      totalDrivers,
    ] = await Promise.all([
      prisma.orderOffer.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.orderOffer.count({ where: { status: "ACCEPTED", createdAt: { gte: thirtyDaysAgo } } }),
      prisma.orderOffer.count({ where: { status: "REJECTED", createdAt: { gte: thirtyDaysAgo } } }),
      prisma.orderOffer.count({ where: { status: "EXPIRED", createdAt: { gte: thirtyDaysAgo } } }),
      prisma.assignment.count({ where: { assignedAt: { gte: thirtyDaysAgo } } }),
      prisma.shipment.count({ where: { dispatchMode: "AUTO_ASSIGNMENT", dispatchAssignedAt: { gte: thirtyDaysAgo } } }),
      prisma.assignment.count({ where: { assignedAt: { gte: thirtyDaysAgo }, status: "CANCELLED" } }),
      prisma.driver.count({ where: { status: { not: "OFFLINE" }, isActive: true } }),
      prisma.driver.count({ where: { isOnline: true, isActive: true } }),
      prisma.driver.count({ where: { isActive: true } }),
    ])

    const acceptanceRate = totalOffers > 0 ? ((acceptedOffers / totalOffers) * 100).toFixed(1) : "0"
    const assignmentSuccessRate = totalAssignments > 0
      ? (((totalAssignments - reassignments) / totalAssignments) * 100).toFixed(1)
      : "0"

    res.json({
      success: true,
      data: {
        totalOffers,
        acceptedOffers,
        rejectedOffers,
        expiredOffers,
        totalAssignments,
        autoAssignments,
        reassignments,
        acceptanceRate: parseFloat(acceptanceRate),
        assignmentSuccessRate: parseFloat(assignmentSuccessRate),
        activeDrivers,
        onlineDrivers,
        totalDrivers,
        driverUtilization: totalDrivers > 0 ? ((activeDrivers / totalDrivers) * 100).toFixed(1) : "0",
      },
    })
  } catch (err) {
    next(err)
  }
}
