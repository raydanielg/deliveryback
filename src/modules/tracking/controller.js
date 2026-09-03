import prisma from "../../prisma/client.js"
import { z } from "zod"

const updateLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  speed: z.number().optional(),
  heading: z.number().optional(),
})

export async function updateDriverLocation(req, res, next) {
  try {
    const data = updateLocationSchema.parse(req.body)

    const driver = await prisma.driver.findFirst({
      where: { userId: req.user.id },
    })

    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" })

    await prisma.driverLocation.create({
      data: {
        driverId: driver.id,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy,
        speed: data.speed,
        heading: data.heading,
      },
    })

    await prisma.driver.update({
      where: { id: driver.id },
      data: {
        currentLatitude: data.latitude,
        currentLongitude: data.longitude,
        lastLocationAt: new Date(),
      },
    })

    res.json({ success: true, message: "Location updated" })
  } catch (err) { next(err) }
}

export async function getDriverLocation(req, res, next) {
  try {
    const { driverId } = req.params

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        currentLatitude: true,
        currentLongitude: true,
        lastLocationAt: true,
        status: true,
        user: { select: { name: true, phone: true } },
      },
    })

    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" })

    res.json({ success: true, data: driver })
  } catch (err) { next(err) }
}

export async function getShipmentTracking(req, res, next) {
  try {
    const { trackingNumber } = req.params

    const shipment = await prisma.shipment.findUnique({
      where: { trackingNumber },
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        category: true,
        transportMode: true,
        fromAddress: true,
        toAddress: true,
        estimatedDelivery: true,
        actualDelivery: true,
      },
    })

    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const events = await prisma.trackingEvent.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { createdAt: "desc" },
    })

    const history = await prisma.shipmentStatusHistory.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { createdAt: "desc" },
    })

    res.json({
      success: true,
      data: {
        shipment,
        events,
        timeline: history,
      },
    })
  } catch (err) { next(err) }
}

export async function addTrackingEvent(req, res, next) {
  try {
    const { shipmentId } = req.params
    const { event, description, location, latitude, longitude } = req.body

    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const trackingEvent = await prisma.trackingEvent.create({
      data: {
        shipmentId,
        event,
        status: shipment.status,
        description,
        location,
        latitude,
        longitude,
        createdBy: req.user?.id,
      },
    })

    res.status(201).json({ success: true, data: trackingEvent })
  } catch (err) { next(err) }
}
