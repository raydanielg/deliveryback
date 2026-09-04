import prisma from "../../prisma/client.js"
import { calculateVolumetricWeight, getChargeableWeight, calculateQuote } from "../pricing/service.js"
import { triggerStatusNotification } from "../notification-service/controller.js"
import { createSGRBookingSchema, verifyWeighSchema, consolidateSchema, loadOnTrainSchema } from "./validation.js"

function generateTrackingNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  return `XRE-SGR-${year}-${random}`
}

function generateOrderNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  return `ORD-SGR-${year}-${random}`
}

function generateBarcode() {
  return `SGR-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`
}

export async function createSGRBooking(req, res, next) {
  try {
    const data = createSGRBookingSchema.parse(req.body)

    const originStation = await prisma.station.findUnique({ where: { id: data.originStationId } })
    if (!originStation) return res.status(400).json({ success: false, message: "Origin station not found" })

    const destStation = await prisma.station.findUnique({ where: { id: data.destinationStationId } })
    if (!destStation) return res.status(400).json({ success: false, message: "Destination station not found" })

    const volumetricWeight = calculateVolumetricWeight(data.lengthCm, data.widthCm, data.heightCm)
    const chargeableWeight = getChargeableWeight(data.actualWeightKg, volumetricWeight)

    const quote = await calculateQuote({
      category: data.category,
      transportMode: "RAIL",
      serviceLevel: data.serviceLevel || "STANDARD",
      actualWeightKg: data.actualWeightKg,
      lengthCm: data.lengthCm,
      widthCm: data.widthCm,
      heightCm: data.heightCm,
      insuranceEnabled: data.insuranceEnabled,
      declaredValue: data.declaredValue || 0,
      currency: "TZS",
    })

    let subtotal, insurancePremium, tax, total

    if (quote.requiresCustomQuote) {
      const baseRate = 2500
      const perKgRate = 1500
      subtotal = baseRate + (Number(chargeableWeight) * perKgRate)
      insurancePremium = data.insuranceEnabled && data.declaredValue
        ? Number(data.declaredValue) * 0.02 : 0
      tax = subtotal * 0.18
      total = subtotal + insurancePremium + tax
    } else {
      subtotal = quote.subtotal
      insurancePremium = quote.insurancePremium
      tax = quote.tax
      total = quote.total
    }

    const fromAddress = await prisma.address.create({
      data: {
        fullName: data.fromFullName,
        phone: data.fromPhone,
        line1: data.fromLine1 || originStation.city || "",
        city: data.fromCity,
        country: data.fromCountry,
      },
    })

    const toAddress = await prisma.address.create({
      data: {
        fullName: data.toFullName,
        phone: data.toPhone,
        line1: data.toLine1 || destStation.city || "",
        city: data.toCity,
        country: data.toCountry,
      },
    })

    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        createdById: req.user.id,
        totalAmount: total,
        currency: "TZS",
        status: "CREATED",
        paymentStatus: "PENDING",
      },
    })

    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber: generateTrackingNumber(),
        orderId: order.id,
        createdById: req.user.id,
        fromAddressId: fromAddress.id,
        toAddressId: toAddress.id,
        category: data.category,
        transportMode: "RAIL",
        serviceLevel: data.serviceLevel,
        fulfillmentType: "DOOR_TO_DOOR",
        status: "BOOKED",
        paymentStatus: "PENDING",
        actualWeightKg: data.actualWeightKg,
        volumetricWeightKg: volumetricWeight,
        chargeableWeightKg: chargeableWeight,
        declaredValue: data.declaredValue || null,
        insuranceEnabled: data.insuranceEnabled,
        insurancePremium: insurancePremium || null,
        totalAmount: total,
        currency: "TZS",
        specialHandling: data.specialHandling,
        description: data.description,
        originStationId: data.originStationId,
        destinationStationId: data.destinationStationId,
        sgrServiceType: data.sgrServiceType,
        trainNumber: data.trainNumber || null,
        trainDepartureAt: data.trainDepartureAt ? new Date(data.trainDepartureAt) : null,
        trainArrivalAt: data.trainArrivalAt ? new Date(data.trainArrivalAt) : null,
      },
      include: {
        originStation: true,
        destinationStation: true,
        order: true,
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        event: "SGR_BOOKING_CREATED",
        status: "BOOKED",
        description: `SGR booking confirmed from ${originStation.name} to ${destStation.name}`,
        location: originStation.city,
      },
    })

    res.status(201).json({ success: true, data: shipment, message: "SGR booking created successfully" })
  } catch (err) { next(err) }
}

export async function listSGRShipments(req, res, next) {
  try {
    const { status, search, originStationId, destinationStationId } = req.query
    const where = { transportMode: "RAIL" }
    if (status) where.status = status
    if (originStationId) where.originStationId = originStationId
    if (destinationStationId) where.destinationStationId = destinationStationId
    if (search) where.trackingNumber = { contains: search, mode: "insensitive" }

    const shipments = await prisma.shipment.findMany({
      where,
      include: {
        originStation: { select: { id: true, name: true, code: true, city: true } },
        destinationStation: { select: { id: true, name: true, code: true, city: true } },
        order: { select: { id: true, orderNumber: true, paymentStatus: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })

    res.json({ success: true, data: shipments })
  } catch (err) { next(err) }
}

export async function getSGRShipment(req, res, next) {
  try {
    const { id } = req.params
    const shipment = await prisma.shipment.findFirst({
      where: { id, transportMode: "RAIL" },
      include: {
        originStation: true,
        destinationStation: true,
        order: true,
        trackingEvents: { orderBy: { createdAt: "desc" } },
        stationInventory: { include: { station: { select: { name: true, code: true } } } },
        manifests: { include: { station: { select: { name: true, code: true } } } },
        packages: true,
      },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "SGR shipment not found" })
    res.json({ success: true, data: shipment })
  } catch (err) { next(err) }
}

export async function verifyAndWeigh(req, res, next) {
  try {
    const { id } = req.params
    const data = verifyWeighSchema.parse(req.body)

    const shipment = await prisma.shipment.findFirst({
      where: { id, transportMode: "RAIL" },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "SGR shipment not found" })

    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        actualWeightKg: data.actualWeightKg,
        chargeableWeightKg: data.actualWeightKg,
        weighedAt: new Date(),
        status: "VERIFIED_WEIGHED",
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: id,
        event: "VERIFIED_WEIGHED",
        status: "VERIFIED_WEIGHED",
        description: `Shipment verified and weighed: ${data.actualWeightKg} kg`,
        notes: data.notes,
      },
    })

    await triggerStatusNotification(id, "VERIFIED_WEIGHED")

    res.json({ success: true, data: updated, message: "Shipment verified and weighed" })
  } catch (err) { next(err) }
}

export async function consolidateShipments(req, res, next) {
  try {
    const data = consolidateSchema.parse(req.body)

    const shipments = await prisma.shipment.findMany({
      where: { id: { in: data.shipmentIds }, transportMode: "RAIL", status: "VERIFIED_WEIGHED" },
    })

    if (shipments.length !== data.shipmentIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some shipments are not found or not in VERIFIED_WEIGHED status",
      })
    }

    await prisma.shipment.updateMany({
      where: { id: { in: data.shipmentIds } },
      data: {
        status: "CONSOLIDATED",
        consolidationBatchId: `CON-SGR-${Date.now()}`,
        trainNumber: data.trainNumber || null,
      },
    })

    for (const shipmentId of data.shipmentIds) {
      await prisma.trackingEvent.create({
        data: {
          shipmentId,
          event: "CONSOLIDATED",
          status: "CONSOLIDATED",
          description: `Shipment consolidated for dispatch${data.trainNumber ? ` on train ${data.trainNumber}` : ""}`,
        },
      })
    }

    res.json({ success: true, message: `${shipments.length} shipments consolidated for SGR dispatch` })
  } catch (err) { next(err) }
}

export async function loadOnTrain(req, res, next) {
  try {
    const data = loadOnTrainSchema.parse(req.body)

    const manifest = await prisma.manifest.findUnique({
      where: { id: data.manifestId },
      include: { shipments: { select: { id: true, trackingNumber: true } } },
    })
    if (!manifest) return res.status(404).json({ success: false, message: "Manifest not found" })

    await prisma.manifest.update({
      where: { id: data.manifestId },
      data: {
        status: "DEPARTED",
        departureAt: data.departedAt ? new Date(data.departedAt) : new Date(),
      },
    })

    await prisma.shipment.updateMany({
      where: { id: { in: manifest.shipments.map((s) => s.id) } },
      data: {
        status: "IN_TRANSIT",
        trainNumber: data.trainNumber,
        trainDepartureAt: data.departedAt ? new Date(data.departedAt) : new Date(),
      },
    })

    for (const shipment of manifest.shipments) {
      await prisma.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          event: "LOADED_ON_TRAIN",
          status: "IN_TRANSIT",
          description: `Loaded on train ${data.trainNumber} and departed`,
        },
      })
      await triggerStatusNotification(shipment.id, "IN_TRANSIT")
    }

    res.json({ success: true, message: `Manifest loaded on train ${data.trainNumber} and departed` })
  } catch (err) { next(err) }
}

export async function arriveAtDestination(req, res, next) {
  try {
    const { id } = req.params
    const { arrivedAt } = req.body

    const manifest = await prisma.manifest.findUnique({
      where: { id },
      include: { shipments: true },
    })
    if (!manifest) return res.status(404).json({ success: false, message: "Manifest not found" })

    await prisma.manifest.update({
      where: { id },
      data: { status: "ARRIVED", arrivalAt: arrivedAt ? new Date(arrivedAt) : new Date() },
    })

    await prisma.shipment.updateMany({
      where: { id: { in: manifest.shipments.map((s) => s.id) } },
      data: { status: "READY_FOR_COLLECTION", trainArrivalAt: arrivedAt ? new Date(arrivedAt) : new Date() },
    })

    for (const shipment of manifest.shipments) {
      await prisma.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          event: "ARRIVED_DESTINATION",
          status: "READY_FOR_COLLECTION",
          description: `Arrived at destination station, ready for collection`,
        },
      })
      await triggerStatusNotification(shipment.id, "READY_FOR_COLLECTION")
    }

    res.json({ success: true, message: "Manifest arrived at destination" })
  } catch (err) { next(err) }
}

export async function getSGRStats(req, res, next) {
  try {
    const total = await prisma.shipment.count({ where: { transportMode: "RAIL" } })
    const byStatus = await prisma.shipment.groupBy({
      by: ["status"],
      where: { transportMode: "RAIL" },
      _count: { status: true },
    })
    const totalWeight = await prisma.shipment.aggregate({
      where: { transportMode: "RAIL" },
      _sum: { chargeableWeightKg: true },
    })
    const stations = await prisma.station.count({ where: { type: "SGR_STATION", isActive: true } })
    const activeManifests = await prisma.manifest.count({
      where: { status: { in: ["PENDING", "LOADING", "DEPARTED", "IN_TRANSIT"] } },
    })

    res.json({
      success: true,
      data: {
        totalShipments: total,
        byStatus,
        totalWeightKg: totalWeight._sum.chargeableWeightKg || 0,
        activeStations: stations,
        activeManifests,
      },
    })
  } catch (err) { next(err) }
}
