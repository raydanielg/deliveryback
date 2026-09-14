import prisma from "../../prisma/client.js"
import { emitToBox, emitToShipment } from "../../realtime/socket.js"
import { toQrPngBuffer } from "../../utils/qr.js"
import { createBoxSchema, addBoxItemSchema, closeBoxSchema, boxStatusSchema } from "./validation.js"

// Timestamp-based, like the existing generateBarcode() in warehouse/controller.js —
// avoids a race-prone sequential counter across concurrent Dubai-office scans.
function generateBoxNumber(stationCode) {
  return `BOX-${stationCode}-${Date.now().toString(36).toUpperCase()}`
}

const BOX_INCLUDE = {
  items: { include: { shipment: { select: { id: true, trackingNumber: true, description: true, createdById: true } } } },
  packedBy: { select: { id: true, name: true } },
  originStation: { select: { id: true, name: true, code: true } },
  currentStation: { select: { id: true, name: true, code: true } },
  currentShelfLocation: true,
  tripManifest: { select: { id: true, tripNo: true, status: true, passengerName: true, flightDate: true } },
}

export async function listBoxes(req, res, next) {
  try {
    const { status, stationId, tripManifestId, search } = req.query
    const where = {}
    if (status) where.status = status
    if (stationId) where.OR = [{ originStationId: stationId }, { currentStationId: stationId }]
    if (tripManifestId) where.tripManifestId = tripManifestId
    if (search) where.boxNumber = { contains: search, mode: "insensitive" }

    const boxes = await prisma.consolidationBox.findMany({
      where, include: BOX_INCLUDE, orderBy: { createdAt: "desc" }, take: 200,
    })
    res.json({ success: true, data: boxes })
  } catch (err) { next(err) }
}

export async function getBox(req, res, next) {
  try {
    const box = await prisma.consolidationBox.findUnique({ where: { id: req.params.id }, include: BOX_INCLUDE })
    if (!box) return res.status(404).json({ success: false, message: "Box not found" })
    res.json({ success: true, data: box })
  } catch (err) { next(err) }
}

export async function createBox(req, res, next) {
  try {
    const data = createBoxSchema.parse(req.body)

    const station = await prisma.station.findUnique({ where: { id: data.originStationId } })
    if (!station) return res.status(404).json({ success: false, message: "Origin station not found" })

    const boxNumber = generateBoxNumber(station.code)
    const box = await prisma.consolidationBox.create({
      data: {
        boxNumber,
        qrPayload: `XRE-BOX-${boxNumber}`,
        targetWeightKg: data.targetWeightKg || 23,
        notes: data.notes,
        packedById: req.user.id,
        originStationId: data.originStationId,
        currentStationId: data.originStationId,
      },
      include: BOX_INCLUDE,
    })
    res.status(201).json({ success: true, data: box, message: `Box ${boxNumber} created` })
  } catch (err) { next(err) }
}

export async function addBoxItem(req, res, next) {
  try {
    const { id } = req.params
    const data = addBoxItemSchema.parse(req.body)

    const box = await prisma.consolidationBox.findUnique({ where: { id } })
    if (!box) return res.status(404).json({ success: false, message: "Box not found" })
    if (box.status !== "PACKING") {
      return res.status(400).json({ success: false, message: `Cannot add items to a box that is ${box.status}` })
    }

    const shipment = await prisma.shipment.findFirst({ where: { trackingNumber: data.trackingNumber } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found for this tracking number" })

    const existing = await prisma.boxItem.findUnique({ where: { boxId_shipmentId: { boxId: id, shipmentId: shipment.id } } })
    if (existing) return res.status(400).json({ success: false, message: "Shipment is already in this box" })

    const [item] = await prisma.$transaction([
      prisma.boxItem.create({ data: { boxId: id, shipmentId: shipment.id, addedById: req.user.id, notes: data.notes } }),
      prisma.shipment.update({ where: { id: shipment.id }, data: { status: "CONSOLIDATED", consolidationBatchId: box.boxNumber } }),
      prisma.trackingEvent.create({
        data: {
          shipmentId: shipment.id, event: "ADDED_TO_BOX", status: "CONSOLIDATED",
          description: `Added to consolidation box ${box.boxNumber}`, createdBy: req.user.id,
        },
      }),
    ])

    emitToBox(id, "box:item_added", { boxId: id, boxNumber: box.boxNumber, shipmentId: shipment.id })
    emitToShipment(shipment.id, "shipment:status_changed", {
      shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, status: "CONSOLIDATED", previousStatus: shipment.status,
    })

    res.status(201).json({ success: true, data: item, message: `Shipment ${data.trackingNumber} added to box ${box.boxNumber}` })
  } catch (err) { next(err) }
}

export async function removeBoxItem(req, res, next) {
  try {
    const { id, shipmentId } = req.params
    const item = await prisma.boxItem.findUnique({ where: { boxId_shipmentId: { boxId: id, shipmentId } } })
    if (!item) return res.status(404).json({ success: false, message: "Item not found in this box" })

    const box = await prisma.consolidationBox.findUnique({ where: { id } })

    await prisma.$transaction([
      prisma.boxItem.delete({ where: { id: item.id } }),
      prisma.trackingEvent.create({
        data: { shipmentId, event: "REMOVED_FROM_BOX", status: "CONSOLIDATED", description: `Removed from consolidation box ${box.boxNumber}`, createdBy: req.user.id },
      }),
    ])

    emitToBox(id, "box:item_removed", { boxId: id, shipmentId })
    res.json({ success: true, message: "Item removed from box" })
  } catch (err) { next(err) }
}

export async function closeBox(req, res, next) {
  try {
    const { id } = req.params
    const data = closeBoxSchema.parse(req.body)

    const box = await prisma.consolidationBox.findUnique({ where: { id }, include: { items: true } })
    if (!box) return res.status(404).json({ success: false, message: "Box not found" })
    if (box.status !== "PACKING") return res.status(400).json({ success: false, message: `Box is already ${box.status}` })
    if (box.items.length === 0) return res.status(400).json({ success: false, message: "Cannot close an empty box" })

    const updated = await prisma.consolidationBox.update({
      where: { id }, data: { status: "PACKED", actualWeightKg: data.actualWeightKg }, include: BOX_INCLUDE,
    })

    emitToBox(id, "box:status_changed", { boxId: id, boxNumber: box.boxNumber, status: "PACKED", previousStatus: "PACKING" })
    res.json({ success: true, data: updated, message: `Box ${box.boxNumber} closed at ${data.actualWeightKg}kg` })
  } catch (err) { next(err) }
}

export async function setBoxStatus(req, res, next) {
  try {
    const { id } = req.params
    const data = boxStatusSchema.parse(req.body)

    const box = await prisma.consolidationBox.findUnique({ where: { id } })
    if (!box) return res.status(404).json({ success: false, message: "Box not found" })

    const updated = await prisma.consolidationBox.update({
      where: { id }, data: { status: data.status, notes: data.notes ?? box.notes }, include: BOX_INCLUDE,
    })

    emitToBox(id, "box:status_changed", { boxId: id, boxNumber: box.boxNumber, status: data.status, previousStatus: box.status })
    res.json({ success: true, data: updated, message: `Box marked ${data.status}` })
  } catch (err) { next(err) }
}

export async function getBoxLabel(req, res, next) {
  try {
    const box = await prisma.consolidationBox.findUnique({ where: { id: req.params.id } })
    if (!box) return res.status(404).json({ success: false, message: "Box not found" })

    const buffer = await toQrPngBuffer(box.qrPayload)
    res.set("Content-Type", "image/png")
    res.send(buffer)
  } catch (err) { next(err) }
}
