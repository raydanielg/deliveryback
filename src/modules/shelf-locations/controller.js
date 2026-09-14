import prisma from "../../prisma/client.js"
import { emitToBox, emitToShipment, emitToStation } from "../../realtime/socket.js"
import { createShelfSchema, assignBoxToShelfSchema, assignShipmentToShelfSchema } from "./validation.js"

export async function listShelves(req, res, next) {
  try {
    const { stationId } = req.query
    const where = {}
    if (stationId) where.stationId = stationId

    const shelves = await prisma.shelfLocation.findMany({
      where,
      include: {
        boxes: { select: { id: true, boxNumber: true, status: true } },
        shipments: { select: { id: true, trackingNumber: true } },
      },
      orderBy: { code: "asc" },
    })
    res.json({ success: true, data: shelves })
  } catch (err) { next(err) }
}

export async function searchShelf(req, res, next) {
  try {
    const { code, stationId } = req.query
    if (!code) return res.status(400).json({ success: false, message: "code query param is required" })

    const shelf = await prisma.shelfLocation.findFirst({
      where: { code, ...(stationId ? { stationId } : {}) },
      include: { boxes: true, shipments: true },
    })
    if (!shelf) return res.status(404).json({ success: false, message: "Shelf not found" })
    res.json({ success: true, data: shelf })
  } catch (err) { next(err) }
}

export async function createShelf(req, res, next) {
  try {
    const data = createShelfSchema.parse(req.body)
    const shelf = await prisma.shelfLocation.create({ data })
    res.status(201).json({ success: true, data: shelf, message: "Shelf location created" })
  } catch (err) { next(err) }
}

export async function assignBoxToShelf(req, res, next) {
  try {
    const { id } = req.params
    const data = assignBoxToShelfSchema.parse(req.body)

    const shelf = await prisma.shelfLocation.findUnique({ where: { id } })
    if (!shelf) return res.status(404).json({ success: false, message: "Shelf not found" })

    const box = await prisma.consolidationBox.findUnique({ where: { id: data.boxId } })
    if (!box) return res.status(404).json({ success: false, message: "Box not found" })

    await prisma.consolidationBox.update({
      where: { id: data.boxId },
      data: { currentShelfLocationId: id, currentStationId: shelf.stationId, status: "SHELVED" },
    })

    emitToBox(data.boxId, "box:shelved", { boxId: data.boxId, shelfLocationId: id, code: shelf.code, stationId: shelf.stationId })
    emitToStation(shelf.stationId, "box:shelved", { boxId: data.boxId, shelfLocationId: id, code: shelf.code })

    res.json({ success: true, message: `Box ${box.boxNumber} shelved at ${shelf.code}` })
  } catch (err) { next(err) }
}

export async function assignShipmentToShelf(req, res, next) {
  try {
    const { id } = req.params
    const data = assignShipmentToShelfSchema.parse(req.body)

    const shelf = await prisma.shelfLocation.findUnique({ where: { id } })
    if (!shelf) return res.status(404).json({ success: false, message: "Shelf not found" })

    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    await prisma.shipment.update({
      where: { id: data.shipmentId },
      data: { shelfLocationId: id, shelfBinLocation: shelf.code },
    })
    await prisma.trackingEvent.create({
      data: { shipmentId: data.shipmentId, event: "SHELF_ASSIGNED", status: shipment.status, description: `Assigned to shelf ${shelf.code}`, createdBy: req.user.id },
    })

    emitToShipment(data.shipmentId, "shipment:shelf_assigned", { shipmentId: data.shipmentId, shelfLocationId: id, code: shelf.code })

    res.json({ success: true, message: `Shipment assigned to shelf ${shelf.code}` })
  } catch (err) { next(err) }
}
