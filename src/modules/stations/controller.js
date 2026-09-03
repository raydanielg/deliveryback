import prisma from "../../prisma/client.js"
import { createStationSchema, receiveShipmentSchema, dispatchInventorySchema } from "./validation.js"

export async function listStations(req, res, next) {
  try {
    const { type, activeOnly, search } = req.query
    const where = {}
    if (activeOnly === "true") where.isActive = true
    if (type) where.type = type
    if (search) where.name = { contains: search, mode: "insensitive" }

    const stations = await prisma.station.findMany({
      where,
      include: {
        _count: {
          select: {
            inventory: { where: { status: "RECEIVED" } },
            shipments: true,
            manifests: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: stations })
  } catch (err) { next(err) }
}

export async function getStation(req, res, next) {
  try {
    const { id } = req.params
    const station = await prisma.station.findUnique({
      where: { id },
      include: {
        inventory: {
          include: { shipment: { select: { trackingNumber: true, status: true, chargeableWeightKg: true, order: { select: { senderName: true, receiverName: true } } } } },
          orderBy: { receivedAt: "desc" },
          take: 50,
        },
        _count: { select: { shipments: true, manifests: true, exceptions: true } },
      },
    })
    if (!station) return res.status(404).json({ success: false, message: "Station not found" })
    res.json({ success: true, data: station })
  } catch (err) { next(err) }
}

export async function createStation(req, res, next) {
  try {
    const data = createStationSchema.parse(req.body)
    const existing = await prisma.station.findUnique({ where: { code: data.code } })
    if (existing) return res.status(400).json({ success: false, message: "Station code already exists" })

    const station = await prisma.station.create({ data })
    res.status(201).json({ success: true, data: station })
  } catch (err) { next(err) }
}

export async function updateStation(req, res, next) {
  try {
    const { id } = req.params
    const data = createStationSchema.partial().parse(req.body)
    const station = await prisma.station.update({ where: { id }, data })
    res.json({ success: true, data: station })
  } catch (err) { next(err) }
}

export async function deleteStation(req, res, next) {
  try {
    const { id } = req.params
    await prisma.station.delete({ where: { id } })
    res.json({ success: true, message: "Station deleted" })
  } catch (err) { next(err) }
}

export async function toggleStation(req, res, next) {
  try {
    const { id } = req.params
    const station = await prisma.station.findUnique({ where: { id } })
    if (!station) return res.status(404).json({ success: false, message: "Station not found" })
    const updated = await prisma.station.update({
      where: { id },
      data: { isActive: !station.isActive },
    })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}

export async function getStationInventory(req, res, next) {
  try {
    const { id } = req.params
    const { status } = req.query
    const where = { stationId: id }
    if (status) where.status = status

    const inventory = await prisma.stationInventory.findMany({
      where,
      include: {
        shipment: {
          select: {
            id: true, trackingNumber: true, status: true, chargeableWeightKg: true,
            order: { select: { senderName: true, receiverName: true, receiverPhone: true } },
          },
        },
      },
      orderBy: { receivedAt: "desc" },
    })
    res.json({ success: true, data: inventory })
  } catch (err) { next(err) }
}

export async function receiveShipment(req, res, next) {
  try {
    const { id } = req.params
    const data = receiveShipmentSchema.parse(req.body)

    const shipment = await prisma.shipment.findFirst({
      where: { trackingNumber: data.trackingNumber },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const existing = await prisma.stationInventory.findFirst({
      where: { stationId: id, shipmentId: shipment.id, status: "RECEIVED" },
    })
    if (existing) return res.status(400).json({ success: false, message: "Shipment already received at this station" })

    const inventory = await prisma.stationInventory.create({
      data: {
        stationId: id,
        shipmentId: shipment.id,
        status: "RECEIVED",
        notes: data.notes,
      },
    })

    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { receivedAtStationId: id, status: "WAREHOUSE" },
    })

    res.status(201).json({ success: true, data: inventory, message: "Shipment received at station" })
  } catch (err) { next(err) }
}

export async function dispatchInventory(req, res, next) {
  try {
    const { id } = req.params
    const data = dispatchInventorySchema.parse(req.body)

    const inventory = await prisma.stationInventory.findFirst({
      where: { id: data.inventoryId, stationId: id, status: "RECEIVED" },
    })
    if (!inventory) return res.status(404).json({ success: false, message: "Inventory item not found or already dispatched" })

    const updated = await prisma.stationInventory.update({
      where: { id: data.inventoryId },
      data: { status: "DISPATCHED", dispatchedAt: new Date(), notes: data.notes },
    })

    res.json({ success: true, data: updated, message: "Inventory dispatched from station" })
  } catch (err) { next(err) }
}

export async function getStationStats(req, res, next) {
  try {
    const total = await prisma.station.count()
    const active = await prisma.station.count({ where: { isActive: true } })
    const byType = await prisma.station.groupBy({
      by: ["type"],
      _count: { type: true },
    })
    const totalInventory = await prisma.stationInventory.count({ where: { status: "RECEIVED" } })
    const totalDispatched = await prisma.stationInventory.count({ where: { status: "DISPATCHED" } })

    res.json({
      success: true,
      data: { total, active, byType, totalInventory, totalDispatched },
    })
  } catch (err) { next(err) }
}
