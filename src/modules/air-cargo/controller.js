import prisma from "../../prisma/client.js"
import { calculateVolumetricWeight, getChargeableWeight, calculateQuote } from "../pricing/service.js"
import { triggerStatusNotification } from "../notification-service/controller.js"
import { createAirCargoBookingSchema, acceptCargoSchema, createFlightDispatchSchema } from "./validation.js"

function generateTrackingNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  return `XRE-AIR-${year}-${random}`
}

function generateOrderNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  return `ORD-AIR-${year}-${random}`
}

function generateAWB() {
  const prefix = Math.floor(Math.random() * 999).toString().padStart(3, "0")
  const serial = Math.floor(Math.random() * 99999999).toString().padStart(8, "0")
  return `${prefix}-${serial}`
}

export async function createAirCargoBooking(req, res, next) {
  try {
    const data = createAirCargoBookingSchema.parse(req.body)

    const volumetricWeight = calculateVolumetricWeight(data.lengthCm, data.widthCm, data.heightCm)
    const chargeableWeight = getChargeableWeight(data.actualWeightKg, volumetricWeight)

    const quote = await calculateQuote({
      category: data.category,
      transportMode: "AIR",
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
      const baseRate = 15000
      const perKgRate = 8000
      subtotal = baseRate + (Number(chargeableWeight) * perKgRate)
      insurancePremium = data.insuranceEnabled && data.declaredValue
        ? Number(data.declaredValue) * 0.03 : 0
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
        line1: data.fromLine1 || "",
        city: data.fromCity,
        country: data.fromCountry,
      },
    })

    const toAddress = await prisma.address.create({
      data: {
        fullName: data.toFullName,
        phone: data.toPhone,
        line1: data.toLine1 || "",
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
        transportMode: "AIR",
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
        specialHandling: data.specialHandling ? [data.specialHandling] : [],
        description: data.description,
        awbNumber: generateAWB(),
        flightNumber: data.flightNumber || null,
        flightDepartureAt: data.flightDepartureAt ? new Date(data.flightDepartureAt) : null,
        flightArrivalAt: data.flightArrivalAt ? new Date(data.flightArrivalAt) : null,
        airportOrigin: data.airportOrigin,
        airportDestination: data.airportDestination,
        airCargoServiceType: data.airCargoServiceType,
        cargoType: data.cargoType,
      },
      include: { order: true },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        event: "AIR_CARGO_BOOKING_CREATED",
        status: "BOOKED",
        description: `Air Cargo booking confirmed from ${data.airportOrigin} to ${data.airportDestination}. AWB: ${shipment.awbNumber}`,
      },
    })

    res.status(201).json({ success: true, data: shipment, message: "Air Cargo booking created successfully" })
  } catch (err) { next(err) }
}

export async function listAirCargoShipments(req, res, next) {
  try {
    const { status, search, airportOrigin, airportDestination } = req.query
    const where = { transportMode: "AIR" }
    if (status) where.status = status
    if (airportOrigin) where.airportOrigin = { contains: airportOrigin, mode: "insensitive" }
    if (airportDestination) where.airportDestination = { contains: airportDestination, mode: "insensitive" }
    if (search) where.trackingNumber = { contains: search, mode: "insensitive" }

    const shipments = await prisma.shipment.findMany({
      where,
      include: {
        order: { select: { id: true, orderNumber: true, paymentStatus: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })

    res.json({ success: true, data: shipments })
  } catch (err) { next(err) }
}

export async function getAirCargoShipment(req, res, next) {
  try {
    const { id } = req.params
    const shipment = await prisma.shipment.findFirst({
      where: { id, transportMode: "AIR" },
      include: {
        order: true,
        trackingEvents: { orderBy: { createdAt: "desc" } },
        packages: true,
        customsDeclaration: true,
        documents: true,
      },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Air Cargo shipment not found" })
    res.json({ success: true, data: shipment })
  } catch (err) { next(err) }
}

export async function acceptCargo(req, res, next) {
  try {
    const { id } = req.params
    const data = acceptCargoSchema.parse(req.body)

    const shipment = await prisma.shipment.findFirst({
      where: { id, transportMode: "AIR" },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Air Cargo shipment not found" })

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
        event: "CARGO_ACCEPTED",
        status: "VERIFIED_WEIGHED",
        description: `Cargo accepted and verified: ${data.actualWeightKg} kg`,
      },
    })

    await triggerStatusNotification(id, "VERIFIED_WEIGHED")

    res.json({ success: true, data: updated, message: "Cargo accepted at airport" })
  } catch (err) { next(err) }
}

export async function createFlightDispatch(req, res, next) {
  try {
    const data = createFlightDispatchSchema.parse(req.body)

    const shipments = await prisma.shipment.findMany({
      where: { id: { in: data.shipmentIds }, transportMode: "AIR", status: "VERIFIED_WEIGHED" },
    })

    if (shipments.length !== data.shipmentIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some shipments are not found or not ready for dispatch",
      })
    }

    const totalWeight = shipments.reduce((sum, s) => sum + Number(s.chargeableWeightKg), 0)

    const manifest = await prisma.manifest.create({
      data: {
        manifestNumber: `XRE-AIR-${Date.now().toString().slice(-8)}`,
        createdById: req.user.id,
        totalShipments: shipments.length,
        totalWeightKg: totalWeight,
        status: "DEPARTED",
        departureAt: new Date(data.flightDepartureAt),
        arrivalAt: new Date(data.flightArrivalAt),
        serviceType: "AIR_CARGO",
        dispatchDate: new Date(data.flightDepartureAt),
        shipments: { connect: data.shipmentIds.map((id) => ({ id })) },
      },
    })

    await prisma.shipment.updateMany({
      where: { id: { in: data.shipmentIds } },
      data: {
        status: "IN_TRANSIT",
        flightNumber: data.flightNumber,
        flightDepartureAt: new Date(data.flightDepartureAt),
        flightArrivalAt: new Date(data.flightArrivalAt),
      },
    })

    for (const shipmentId of data.shipmentIds) {
      await prisma.trackingEvent.create({
        data: {
          shipmentId,
          event: "UPLIFTED",
          status: "IN_TRANSIT",
          description: `Cargo uplifted on flight ${data.flightNumber}`,
        },
      })
      await triggerStatusNotification(shipmentId, "IN_TRANSIT")
    }

    res.status(201).json({ success: true, data: manifest, message: `Flight dispatch created for ${shipments.length} shipments` })
  } catch (err) { next(err) }
}

export async function arriveAtAirport(req, res, next) {
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
      data: {
        status: "ARRIVED_DESTINATION",
        flightArrivalAt: arrivedAt ? new Date(arrivedAt) : new Date(),
      },
    })

    for (const shipment of manifest.shipments) {
      await prisma.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          event: "ARRIVED_AIRPORT",
          status: "ARRIVED_DESTINATION",
          description: `Cargo arrived at destination airport`,
        },
      })
      await triggerStatusNotification(shipment.id, "ARRIVED_DESTINATION")
    }

    res.json({ success: true, message: "Flight arrived at destination airport" })
  } catch (err) { next(err) }
}

export async function getAirCargoStats(req, res, next) {
  try {
    const total = await prisma.shipment.count({ where: { transportMode: "AIR" } })
    const byStatus = await prisma.shipment.groupBy({
      by: ["status"],
      where: { transportMode: "AIR" },
      _count: { status: true },
    })
    const totalWeight = await prisma.shipment.aggregate({
      where: { transportMode: "AIR" },
      _sum: { chargeableWeightKg: true },
    })
    const airports = await prisma.station.count({ where: { type: "AIRPORT_CARGO", isActive: true } })

    res.json({
      success: true,
      data: {
        totalShipments: total,
        byStatus,
        totalWeightKg: totalWeight._sum.chargeableWeightKg || 0,
        activeAirports: airports,
      },
    })
  } catch (err) { next(err) }
}
