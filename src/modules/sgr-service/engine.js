import prisma from "../../prisma/client.js"
import { createTransportRequest } from "../transport/service.js"
import { createTripForAssignment } from "../trips/controller.js"
import { emitEvent, EVENTS } from "../integrations/event-bus.js"
import { createNotification } from "../notifications/controller.js"
import { triggerStatusNotification } from "../notification-service/controller.js"

// ============================================================
// SGR LOGISTICS ENGINE
// ============================================================
// Integrates SGR as a full transport mode inside the XERIN logistics
// engine. Supports multi-leg shipments (first mile → rail → last mile),
// station operations, train assignment, package-level tracking,
// exceptions, and settlement.
// ============================================================

// ---------------------------------------------------------
// 1. MULTI-LEG CREATION — called after SGR booking is created
// ---------------------------------------------------------

export async function createSGRLegs(shipmentId) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      originStation: true,
      destinationStation: true,
      fromAddress: true,
      toAddress: true,
    },
  })
  if (!shipment) throw new Error("Shipment not found")
  if (shipment.transportMode !== "RAIL") throw new Error("Shipment is not an SGR shipment")

  const serviceType = shipment.sgrServiceType || "STATION_TO_STATION"
  const legs = []

  // Leg 1: FIRST_MILE (Door → Station) — only for DOOR_TO_STATION and DOOR_TO_DOOR
  if (serviceType === "DOOR_TO_STATION" || serviceType === "DOOR_TO_DOOR") {
    legs.push({
      legNumber: 1,
      legType: "FIRST_MILE",
      originLabel: shipment.fromAddress
        ? `${shipment.fromAddress.city || "Customer Address"}`
        : "Customer Address",
      destLabel: shipment.originStation?.name || "Origin Station",
      originStationId: null,
      destStationId: shipment.originStationId,
    })
  }

  // Leg 2: RAIL (Station → Station) — always present for SGR
  const railLegNumber = legs.length + 1
  legs.push({
    legNumber: railLegNumber,
    legType: "RAIL",
    originLabel: shipment.originStation?.name || "Origin Station",
    destLabel: shipment.destinationStation?.name || "Destination Station",
    originStationId: shipment.originStationId,
    destStationId: shipment.destinationStationId,
  })

  // Leg 3: LAST_MILE (Station → Door) — only for STATION_TO_DOOR and DOOR_TO_DOOR
  if (serviceType === "STATION_TO_DOOR" || serviceType === "DOOR_TO_DOOR") {
    legs.push({
      legNumber: railLegNumber + 1,
      legType: "LAST_MILE",
      originLabel: shipment.destinationStation?.name || "Destination Station",
      destLabel: shipment.toAddress
        ? `${shipment.toAddress.city || "Customer Address"}`
        : "Customer Address",
      originStationId: shipment.destinationStationId,
      destStationId: null,
    })
  }

  // Create legs in database
  const createdLegs = []
  for (const leg of legs) {
    const created = await prisma.sgrLeg.create({
      data: {
        shipmentId,
        legNumber: leg.legNumber,
        legType: leg.legType,
        originLabel: leg.originLabel,
        destLabel: leg.destLabel,
        originStationId: leg.originStationId,
        destStationId: leg.destStationId,
        status: "PENDING",
      },
    })
    createdLegs.push(created)
  }

  return createdLegs
}

// ---------------------------------------------------------
// 2. FIRST MILE — create transport request + open to driver marketplace
// ---------------------------------------------------------

export async function initiateFirstMile(shipmentId, req) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { sgrLegs: true, originStation: true, fromAddress: true },
  })
  if (!shipment) throw new Error("Shipment not found")

  const firstMileLeg = shipment.sgrLegs.find((l) => l.legType === "FIRST_MILE")
  if (!firstMileLeg) throw new Error("No first-mile leg found for this shipment")
  if (firstMileLeg.status !== "PENDING") throw new Error("First-mile leg already initiated")

  // Create transport request for first mile
  const tr = await createTransportRequest(shipmentId, "OPEN_ORDER")

  // Update shipment status
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: "AWAITING_PICKUP" },
  })

  // Update leg status
  await prisma.sgrLeg.update({
    where: { id: firstMileLeg.id },
    data: {
      status: "DRIVER_ASSIGNED",
      transportRequestId: tr.id,
      startedAt: new Date(),
    },
  })

  // Create tracking event
  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      event: "FIRST_MILE_INITIATED",
      status: "AWAITING_PICKUP",
      description: `First mile transport request created. Awaiting driver assignment for pickup to ${shipment.originStation?.name || "origin station"}.`,
      createdBy: req?.user?.id,
    },
  })

  return { transportRequest: tr, leg: firstMileLeg }
}

// ---------------------------------------------------------
// 3. STATION OPERATIONS — receive cargo at station
// ---------------------------------------------------------

export async function receiveCargoAtStation(shipmentId, stationId, userId, scanData = {}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { packages: true, originStation: true },
  })
  if (!shipment) throw new Error("Shipment not found")
  if (shipment.transportMode !== "RAIL") throw new Error("Not an SGR shipment")

  const station = await prisma.station.findUnique({ where: { id: stationId } })
  if (!station) throw new Error("Station not found")

  // Verify this is the correct origin station
  if (shipment.originStationId !== stationId) {
    throw new Error(`Wrong station. Cargo should be received at ${shipment.originStation?.name}`)
  }

  // Check if already received
  if (["CARGO_RECEIVED", "SCREENING", "READY_FOR_RAIL", "TRAIN_ASSIGNED", "MANIFESTED", "LOADED"].includes(shipment.status)) {
    throw new Error("Cargo already received at station")
  }

  // Update shipment status
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      status: "CARGO_RECEIVED",
      receivedAtStationId: stationId,
    },
  })

  // Update first mile leg if exists
  const firstMileLeg = await prisma.sgrLeg.findFirst({
    where: { shipmentId, legType: "FIRST_MILE" },
  })
  if (firstMileLeg) {
    await prisma.sgrLeg.update({
      where: { id: firstMileLeg.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    })
  }

  // Scan packages if package data provided
  let packagesScanned = 0
  if (scanData.packageBarcodes && Array.isArray(scanData.packageBarcodes)) {
    for (const barcode of scanData.packageBarcodes) {
      const pkg = await prisma.package.findFirst({
        where: { shipmentId, barcode },
      })
      if (pkg) {
        await prisma.package.update({
          where: { id: pkg.id },
          data: { status: "SCANNED_AT_WAREHOUSE" },
        })
        packagesScanned++
      }
    }
  }

  // Create tracking event
  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      event: "CARGO_RECEIVED_AT_STATION",
      status: "CARGO_RECEIVED",
      description: `Cargo received at ${station.name}. Packages scanned: ${packagesScanned || "N/A"}.`,
      location: station.city,
      createdBy: userId,
    },
  })

  // Notify customer
  await triggerStatusNotification(shipmentId, "CARGO_RECEIVED")

  return { shipment, station, packagesScanned }
}

// ---------------------------------------------------------
// 4. SCREENING — security/screening check
// ---------------------------------------------------------

export async function startScreening(shipmentId, userId, screeningData = {}) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } })
  if (!shipment) throw new Error("Shipment not found")
  if (shipment.status !== "CARGO_RECEIVED") {
    throw new Error(`Cannot screen: shipment status is ${shipment.status}, expected CARGO_RECEIVED`)
  }

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: "SCREENING" },
  })

  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      event: "SCREENING_STARTED",
      status: "SCREENING",
      description: `Security screening started${screeningData.notes ? `: ${screeningData.notes}` : ""}`,
      createdBy: userId,
    },
  })

  return { shipmentId, status: "SCREENING" }
}

export async function completeScreening(shipmentId, userId, screeningResult = {}) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } })
  if (!shipment) throw new Error("Shipment not found")
  if (shipment.status !== "SCREENING") {
    throw new Error(`Cannot complete screening: shipment status is ${shipment.status}`)
  }

  // If screening failed, create exception
  if (screeningResult.passed === false) {
    await prisma.shipmentException.create({
      data: {
        shipmentId,
        type: "SCREENING_ISSUE",
        reason: screeningResult.reason || "Failed security screening",
        description: screeningResult.description,
      },
    })

    await prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: "EXCEPTION" },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId,
        event: "SCREENING_FAILED",
        status: "EXCEPTION",
        description: `Screening failed: ${screeningResult.reason || "Security issue detected"}`,
        createdBy: userId,
      },
    })

    throw new Error("Screening failed — exception created")
  }

  // Screening passed → ready for rail
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: "READY_FOR_RAIL" },
  })

  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      event: "SCREENING_PASSED",
      status: "READY_FOR_RAIL",
      description: "Security screening completed. Cargo ready for rail transport.",
      createdBy: userId,
    },
  })

  return { shipmentId, status: "READY_FOR_RAIL" }
}

// ---------------------------------------------------------
// 5. TRAIN ASSIGNMENT — allocate shipment to train with capacity check
// ---------------------------------------------------------

export async function assignToTrain(shipmentId, trainCapacityId, userId) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { packages: true },
  })
  if (!shipment) throw new Error("Shipment not found")
  if (!["READY_FOR_RAIL", "TRAIN_ASSIGNED"].includes(shipment.status)) {
    throw new Error(`Shipment must be READY_FOR_RAIL, currently ${shipment.status}`)
  }

  const train = await prisma.trainCapacity.findUnique({ where: { id: trainCapacityId } })
  if (!train) throw new Error("Train not found")
  if (!train.isActive) throw new Error("Train is not active")
  if (train.status === "DEPARTED" || train.status === "ARRIVED") {
    throw new Error("Train has already departed or arrived")
  }

  // Check for duplicate allocation
  const existing = await prisma.trainAllocation.findUnique({
    where: {
      trainCapacityId_shipmentId: { trainCapacityId, shipmentId },
    },
  })
  if (existing) throw new Error("Shipment already allocated to this train")

  // Capacity check
  const shipmentWeight = Number(shipment.chargeableWeightKg)
  const currentAllocated = Number(train.allocatedKg)
  const totalCapacity = Number(train.totalCapacityKg)
  if (currentAllocated + shipmentWeight > totalCapacity) {
    throw new Error(`Insufficient capacity: ${shipmentWeight}kg needed, only ${totalCapacity - currentAllocated}kg remaining`)
  }

  // Create allocation
  const allocation = await prisma.trainAllocation.create({
    data: {
      trainCapacityId,
      shipmentId,
      allocatedWeightKg: shipmentWeight,
      packageCount: shipment.packages.length || 1,
      loadingStationId: shipment.originStationId,
      receivingStationId: shipment.destinationStationId,
      status: "ALLOCATED",
    },
  })

  // Update train capacity
  const newAllocated = currentAllocated + shipmentWeight
  const newRemaining = totalCapacity - newAllocated
  await prisma.trainCapacity.update({
    where: { id: trainCapacityId },
    data: {
      allocatedKg: newAllocated,
      remainingKg: newRemaining,
      status: newAllocated >= totalCapacity ? "FULL" : "SCHEDULED",
    },
  })

  // Update shipment
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      status: "TRAIN_ASSIGNED",
      trainNumber: train.trainNumber,
      trainDepartureAt: train.departureAt,
      trainArrivalAt: train.arrivalAt,
    },
  })

  // Update rail leg
  const railLeg = await prisma.sgrLeg.findFirst({
    where: { shipmentId, legType: "RAIL" },
  })
  if (railLeg) {
    await prisma.sgrLeg.update({
      where: { id: railLeg.id },
      data: {
        trainCapacityId,
        trainNumber: train.trainNumber,
        status: "DRIVER_ASSIGNED", // train assigned
      },
    })
  }

  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      event: "TRAIN_ASSIGNED",
      status: "TRAIN_ASSIGNED",
      description: `Assigned to train ${train.trainNumber} on ${train.route}. Departure: ${train.departureAt?.toISOString()}`,
      createdBy: userId,
    },
  })

  await triggerStatusNotification(shipmentId, "TRAIN_ASSIGNED")

  return { allocation, train, shipment }
}

// ---------------------------------------------------------
// 6. CARGO LOADING — load cargo onto train (scan + verify)
// ---------------------------------------------------------

export async function loadCargoOnTrain(shipmentId, trainCapacityId, userId, scanData = {}) {
  const allocation = await prisma.trainAllocation.findUnique({
    where: {
      trainCapacityId_shipmentId: { trainCapacityId, shipmentId },
    },
    include: { trainCapacity: true, shipment: { include: { packages: true } } },
  })
  if (!allocation) throw new Error("Shipment not allocated to this train")
  if (allocation.status === "LOADED") throw new Error("Cargo already loaded")

  // Scan packages if provided
  let packagesLoaded = 0
  if (scanData.packageBarcodes && Array.isArray(scanData.packageBarcodes)) {
    for (const barcode of scanData.packageBarcodes) {
      const pkg = await prisma.package.findFirst({
        where: { shipmentId, barcode },
      })
      if (pkg) {
        await prisma.package.update({
          where: { id: pkg.id },
          data: { status: "LOADED" },
        })
        packagesLoaded++
      }
    }
  }

  // Update allocation
  await prisma.trainAllocation.update({
    where: { id: allocation.id },
    data: {
      status: "LOADED",
      loadedAt: new Date(),
      loadedById: userId,
    },
  })

  // Update train used capacity
  const train = allocation.trainCapacity
  const newUsed = Number(train.usedKg) + Number(allocation.allocatedWeightKg)
  await prisma.trainCapacity.update({
    where: { id: trainCapacityId },
    data: { usedKg: newUsed },
  })

  // Update shipment
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: "LOADED" },
  })

  // Update rail leg
  await prisma.sgrLeg.updateMany({
    where: { shipmentId, legType: "RAIL" },
    data: { status: "LOADED_ON_TRAIN" },
  })

  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      event: "CARGO_LOADED",
      status: "LOADED",
      description: `Cargo loaded onto train ${train.trainNumber}. Packages loaded: ${packagesLoaded || "all"}.`,
      createdBy: userId,
    },
  })

  await triggerStatusNotification(shipmentId, "LOADED")

  return { allocation, packagesLoaded }
}

// ---------------------------------------------------------
// 7. TRAIN DEPARTURE — bulk update all shipments on train
// ---------------------------------------------------------

export async function departTrain(trainCapacityId, userId) {
  const train = await prisma.trainCapacity.findUnique({
    where: { id: trainCapacityId },
    include: {
      allocations: {
        where: { status: "LOADED" },
        include: { shipment: true },
      },
    },
  })
  if (!train) throw new Error("Train not found")
  if (train.status === "DEPARTED") throw new Error("Train already departed")

  // Update train status
  await prisma.trainCapacity.update({
    where: { id: trainCapacityId },
    data: { status: "DEPARTED" },
  })

  // Update all loaded allocations
  await prisma.trainAllocation.updateMany({
    where: { trainCapacityId, status: "LOADED" },
    data: { status: "IN_TRANSIT" },
  })

  // Bulk update shipments
  const shipmentIds = train.allocations.map((a) => a.shipmentId)
  if (shipmentIds.length > 0) {
    await prisma.shipment.updateMany({
      where: { id: { in: shipmentIds } },
      data: {
        status: "TRAIN_DEPARTED",
        trainDepartureAt: new Date(),
      },
    })

    // Update rail legs
    await prisma.sgrLeg.updateMany({
      where: { shipmentId: { in: shipmentIds }, legType: "RAIL" },
      data: { status: "IN_TRANSIT" },
    })

    // Create tracking events + notifications for each shipment
    for (const allocation of train.allocations) {
      await prisma.trackingEvent.create({
        data: {
          shipmentId: allocation.shipmentId,
          event: "TRAIN_DEPARTED",
          status: "TRAIN_DEPARTED",
          description: `Train ${train.trainNumber} has departed from ${train.route}.`,
          createdBy: userId,
        },
      })
      await triggerStatusNotification(allocation.shipmentId, "TRAIN_DEPARTED")
    }
  }

  // Emit event for partner webhooks
  await emitEvent(EVENTS.SGR_DEPARTED, {
    trainCapacityId,
    trainNumber: train.trainNumber,
    shipmentIds,
    status: "TRAIN_DEPARTED",
  })

  return { train, shipmentsUpdated: shipmentIds.length }
}

// ---------------------------------------------------------
// 8. TRAIN ARRIVAL — bulk update + destination station receiving
// ---------------------------------------------------------

export async function arriveTrain(trainCapacityId, userId, arrivalData = {}) {
  const train = await prisma.trainCapacity.findUnique({
    where: { id: trainCapacityId },
    include: {
      allocations: {
        where: { status: "IN_TRANSIT" },
        include: { shipment: { include: { packages: true } } },
      },
    },
  })
  if (!train) throw new Error("Train not found")
  if (train.status === "ARRIVED") throw new Error("Train already marked as arrived")

  // Update train status
  await prisma.trainCapacity.update({
    where: { id: trainCapacityId },
    data: {
      status: "ARRIVED",
      arrivalAt: arrivalData.arrivedAt ? new Date(arrivalData.arrivedAt) : new Date(),
    },
  })

  const shipmentIds = train.allocations.map((a) => a.shipmentId)

  // Update allocations
  await prisma.trainAllocation.updateMany({
    where: { trainCapacityId, status: "IN_TRANSIT" },
    data: {
      status: "ARRIVED",
      arrivedAt: new Date(),
      unloadedById: userId,
    },
  })

  // Determine next status based on service type
  for (const allocation of train.allocations) {
    const shipment = allocation.shipment
    const serviceType = shipment.sgrServiceType || "STATION_TO_STATION"

    // Check package count if packages exist
    if (shipment.packages.length > 0) {
      const expectedCount = shipment.packages.length
      // Packages should have been scanned at various points
      // If any are missing, create a discrepancy exception
      const missingPackages = shipment.packages.filter((p) => !["LOADED", "DEPARTED", "ARRIVED"].includes(p.status))
      if (missingPackages.length > 0) {
        await prisma.shipmentException.create({
          data: {
            shipmentId: shipment.id,
            type: "PACKAGE_DISCREPANCY",
            reason: `${missingPackages.length} package(s) not accounted for at train arrival`,
            description: `Expected ${expectedCount}, but ${missingPackages.length} package(s) missing. Missing barcodes: ${missingPackages.map((p) => p.barcode).join(", ")}`,
          },
        })
      }
    }

    // Update packages to ARRIVED
    await prisma.package.updateMany({
      where: { shipmentId: shipment.id },
      data: { status: "ARRIVED" },
    })

    // Determine next status
    let nextStatus = "READY_FOR_COLLECTION"
    if (serviceType === "STATION_TO_DOOR" || serviceType === "DOOR_TO_DOOR") {
      nextStatus = "DESTINATION_STATION"
    }

    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: nextStatus,
        trainArrivalAt: new Date(),
      },
    })

    // Update rail leg
    await prisma.sgrLeg.updateMany({
      where: { shipmentId: shipment.id, legType: "RAIL" },
      data: { status: "ARRIVED_STATION" },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        event: "TRAIN_ARRIVED",
        status: nextStatus,
        description: `Train ${train.trainNumber} has arrived at destination. ${
          nextStatus === "READY_FOR_COLLECTION"
            ? "Cargo ready for collection at station."
            : "Cargo ready for last-mile delivery."
        }`,
        createdBy: userId,
      },
    })

    await triggerStatusNotification(shipment.id, "TRAIN_ARRIVED")
  }

  await emitEvent(EVENTS.SGR_ARRIVED, {
    trainCapacityId,
    trainNumber: train.trainNumber,
    shipmentIds,
    status: "TRAIN_ARRIVED",
  })

  return { train, shipmentsUpdated: shipmentIds.length }
}

// ---------------------------------------------------------
// 9. LAST MILE — create transport request for station-to-door
// ---------------------------------------------------------

export async function initiateLastMile(shipmentId, req) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { sgrLegs: true, destinationStation: true, toAddress: true },
  })
  if (!shipment) throw new Error("Shipment not found")

  const lastMileLeg = shipment.sgrLegs.find((l) => l.legType === "LAST_MILE")
  if (!lastMileLeg) throw new Error("No last-mile leg found for this shipment")
  if (!["PENDING", "DRIVER_ASSIGNED"].includes(lastMileLeg.status)) {
    throw new Error("Last-mile leg already initiated or completed")
  }

  if (!["DESTINATION_STATION", "READY_FOR_COLLECTION"].includes(shipment.status)) {
    throw new Error(`Shipment must be at destination station, currently ${shipment.status}`)
  }

  // Create transport request for last mile
  const tr = await createTransportRequest(shipmentId, "OPEN_ORDER")

  // Update shipment status
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: "LAST_MILE_ASSIGNED" },
  })

  // Update leg
  await prisma.sgrLeg.update({
    where: { id: lastMileLeg.id },
    data: {
      status: "DRIVER_ASSIGNED",
      transportRequestId: tr.id,
      startedAt: new Date(),
    },
  })

  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      event: "LAST_MILE_INITIATED",
      status: "LAST_MILE_ASSIGNED",
      description: `Last mile transport request created. Awaiting driver for delivery from ${shipment.destinationStation?.name || "station"} to customer.`,
      createdBy: req?.user?.id,
    },
  })

  return { transportRequest: tr, leg: lastMileLeg }
}

// ---------------------------------------------------------
// 10. COLLECTION VERIFICATION — for STATION_TO_STATION
// ---------------------------------------------------------

export async function verifyCollection(shipmentId, userId, collectionData = {}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { packages: true, destinationStation: true },
  })
  if (!shipment) throw new Error("Shipment not found")
  if (shipment.status !== "READY_FOR_COLLECTION") {
    throw new Error(`Shipment not ready for collection, currently ${shipment.status}`)
  }

  // Verify OTP if provided
  if (collectionData.otp && shipment.otp && collectionData.otp !== shipment.otp) {
    throw new Error("Invalid collection OTP")
  }

  // Update packages to DELIVERED
  await prisma.package.updateMany({
    where: { shipmentId },
    data: { status: "DELIVERED" },
  })

  // Update shipment
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      status: "COLLECTED",
    },
  })

  // Update rail leg (if no last mile)
  const lastMileLeg = await prisma.sgrLeg.findFirst({
    where: { shipmentId, legType: "LAST_MILE" },
  })
  if (!lastMileLeg) {
    // STATION_TO_STATION — mark rail leg as completed
    await prisma.sgrLeg.updateMany({
      where: { shipmentId, legType: "RAIL" },
      data: { status: "COMPLETED", completedAt: new Date() },
    })
  }

  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      event: "CARGO_COLLECTED",
      status: "COLLECTED",
      description: `Cargo collected by customer at ${shipment.destinationStation?.name || "station"}. Verified via ${collectionData.otp ? "OTP" : "identification"}.`,
      createdBy: userId,
    },
  })

  await triggerStatusNotification(shipmentId, "COLLECTED")

  return { shipment, collected: true }
}

// ---------------------------------------------------------
// 11. SGR EXCEPTION — raise exception
// ---------------------------------------------------------

export async function raiseSGRException(shipmentId, userId, exceptionData = {}) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } })
  if (!shipment) throw new Error("Shipment not found")

  const exception = await prisma.shipmentException.create({
    data: {
      shipmentId,
      type: exceptionData.type,
      reason: exceptionData.reason,
      description: exceptionData.description,
      stationId: exceptionData.stationId,
    },
  })

  // Update shipment to EXCEPTION if it's not already
  if (shipment.status !== "EXCEPTION") {
    await prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: "EXCEPTION" },
    })
  }

  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      event: "EXCEPTION_RAISED",
      status: "EXCEPTION",
      description: `Exception: ${exceptionData.type} — ${exceptionData.reason}`,
      createdBy: userId,
    },
  })

  // Notify dispatchers
  const dispatchers = await prisma.user.findMany({
    where: { role: { in: ["DISPATCHER", "OPERATIONS_MANAGER", "SUPER_ADMIN"] } },
    select: { id: true },
  })
  for (const d of dispatchers) {
    createNotification(
      d.id,
      "SGR_EXCEPTION",
      "SGR Exception Raised",
      `Shipment ${shipment.trackingNumber}: ${exceptionData.type} — ${exceptionData.reason}`,
      { shipmentId }
    ).catch(() => {})
  }

  return exception
}

// ---------------------------------------------------------
// 12. SGR CONTROL TOWER — overview stats
// ---------------------------------------------------------

export async function getSGRControlTower() {
  const [
    total,
    awaitingCargo,
    cargoReceived,
    screening,
    readyForRail,
    trainAssigned,
    manifested,
    loaded,
    inTransit,
    trainArrived,
    destStation,
    readyForCollection,
    lastMile,
    outForDelivery,
    delivered,
    collected,
    exceptions,
  ] = await Promise.all([
    prisma.shipment.count({ where: { transportMode: "RAIL" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "AWAITING_CARGO" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "CARGO_RECEIVED" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "SCREENING" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "READY_FOR_RAIL" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "TRAIN_ASSIGNED" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "MANIFESTED" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "LOADED" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: { in: ["TRAIN_DEPARTED", "IN_TRANSIT"] } } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "TRAIN_ARRIVED" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "DESTINATION_STATION" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "READY_FOR_COLLECTION" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "LAST_MILE_ASSIGNED" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "OUT_FOR_DELIVERY" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "DELIVERED" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "COLLECTED" } }),
    prisma.shipment.count({ where: { transportMode: "RAIL", status: "EXCEPTION" } }),
  ])

  // Train departures today
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const trainsToday = await prisma.trainCapacity.findMany({
    where: {
      departureAt: { gte: today, lt: tomorrow },
      isActive: true,
    },
    include: {
      allocations: {
        where: { status: { in: ["ALLOCATED", "LOADED", "IN_TRANSIT"] } },
        select: { id: true, allocatedWeightKg: true, status: true },
      },
    },
    orderBy: { departureAt: "asc" },
  })

  // Active exceptions
  const activeExceptions = await prisma.shipmentException.findMany({
    where: {
      status: { in: ["OPEN", "IN_REVIEW"] },
      shipment: { transportMode: "RAIL" },
    },
    include: {
      shipment: { select: { trackingNumber: true, id: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  })

  return {
    stats: {
      total,
      awaitingCargo,
      cargoReceived,
      screening,
      readyForRail,
      trainAssigned,
      manifested,
      loaded,
      inTransit,
      trainArrived,
      destStation,
      readyForCollection,
      lastMile,
      outForDelivery,
      delivered,
      collected,
      exceptions,
    },
    trainsToday: trainsToday.map((t) => ({
      id: t.id,
      trainNumber: t.trainNumber,
      route: t.route,
      departureAt: t.departureAt,
      arrivalAt: t.arrivalAt,
      totalCapacityKg: Number(t.totalCapacityKg),
      allocatedKg: Number(t.allocatedKg),
      usedKg: Number(t.usedKg),
      remainingKg: Number(t.remainingKg),
      status: t.status,
      allocationsCount: t.allocations.length,
    })),
    activeExceptions,
  }
}

// ---------------------------------------------------------
// 13. PACKAGE-LEVEL TRACKING — get package status summary
// ---------------------------------------------------------

export async function getPackageTracking(shipmentId) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { packages: true },
  })
  if (!shipment) throw new Error("Shipment not found")

  const packages = shipment.packages
  const summary = {
    total: packages.length,
    created: packages.filter((p) => p.status === "CREATED").length,
    scannedAtPickup: packages.filter((p) => p.status === "SCANNED_AT_PICKUP").length,
    scannedAtWarehouse: packages.filter((p) => p.status === "SCANNED_AT_WAREHOUSE").length,
    loaded: packages.filter((p) => p.status === "LOADED").length,
    departed: packages.filter((p) => p.status === "DEPARTED").length,
    arrived: packages.filter((p) => p.status === "ARRIVED").length,
    outForDelivery: packages.filter((p) => p.status === "OUT_FOR_DELIVERY").length,
    delivered: packages.filter((p) => p.status === "DELIVERED").length,
    damaged: packages.filter((p) => p.status === "DAMAGED").length,
    lost: packages.filter((p) => p.status === "LOST").length,
  }

  // Check for discrepancies
  const discrepancies = []
  if (summary.total > 0) {
    if (summary.scannedAtWarehouse + summary.loaded + summary.departed + summary.arrived + summary.delivered < summary.total) {
      discrepancies.push({
        type: "RECEIVING",
        expected: summary.total,
        received: summary.scannedAtWarehouse + summary.loaded + summary.departed + summary.arrived + summary.delivered,
      })
    }
    if (summary.loaded + summary.departed + summary.arrived + summary.delivered < summary.total && shipment.status === "LOADED") {
      discrepancies.push({
        type: "LOADING",
        expected: summary.total,
        loaded: summary.loaded,
      })
    }
  }

  return { summary, packages, discrepancies }
}
