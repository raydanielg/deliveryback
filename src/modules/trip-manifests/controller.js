import prisma from "../../prisma/client.js"
import { emitToBox, emitToTrip } from "../../realtime/socket.js"
import { createTripSchema, pairBoxSchema, updateTripStatusSchema } from "./validation.js"

function generateTripNo() {
  return `TRP-${Date.now().toString(36).toUpperCase()}`
}

const TRIP_INCLUDE = {
  boxes: { include: { items: { include: { shipment: { select: { id: true, trackingNumber: true } } } } } },
  createdBy: { select: { id: true, name: true } },
}

export async function listTrips(req, res, next) {
  try {
    const { status, search } = req.query
    const where = {}
    if (status) where.status = status
    if (search) {
      where.OR = [
        { tripNo: { contains: search, mode: "insensitive" } },
        { passengerName: { contains: search, mode: "insensitive" } },
      ]
    }

    const trips = await prisma.tripManifest.findMany({ where, include: TRIP_INCLUDE, orderBy: { flightDate: "desc" }, take: 200 })
    res.json({ success: true, data: trips })
  } catch (err) { next(err) }
}

export async function getTrip(req, res, next) {
  try {
    const trip = await prisma.tripManifest.findUnique({ where: { id: req.params.id }, include: TRIP_INCLUDE })
    if (!trip) return res.status(404).json({ success: false, message: "Trip manifest not found" })
    res.json({ success: true, data: trip })
  } catch (err) { next(err) }
}

export async function createTrip(req, res, next) {
  try {
    const data = createTripSchema.parse(req.body)
    const tripNo = generateTripNo()

    const trip = await prisma.tripManifest.create({
      data: { ...data, tripNo, qrPayload: `XRE-TRP-${tripNo}`, createdById: req.user.id },
      include: TRIP_INCLUDE,
    })
    res.status(201).json({ success: true, data: trip, message: `Trip manifest ${tripNo} created` })
  } catch (err) { next(err) }
}

export async function pairBox(req, res, next) {
  try {
    const { id } = req.params
    const data = pairBoxSchema.parse(req.body)

    const trip = await prisma.tripManifest.findUnique({ where: { id } })
    if (!trip) return res.status(404).json({ success: false, message: "Trip manifest not found" })

    const box = await prisma.consolidationBox.findUnique({ where: { id: data.boxId } })
    if (!box) return res.status(404).json({ success: false, message: "Box not found" })
    if (box.status !== "PACKED") {
      return res.status(400).json({ success: false, message: `Box must be PACKED before assigning to a trip (currently ${box.status})` })
    }

    await prisma.$transaction([
      prisma.consolidationBox.update({ where: { id: data.boxId }, data: { tripManifestId: id, status: "HANDED_TO_PASSENGER" } }),
      prisma.tripManifest.update({ where: { id }, data: { status: "BOXES_ASSIGNED" } }),
    ])

    emitToBox(data.boxId, "box:status_changed", { boxId: data.boxId, boxNumber: box.boxNumber, status: "HANDED_TO_PASSENGER", previousStatus: box.status })
    emitToTrip(id, "trip:updated", { tripManifestId: id, tripNo: trip.tripNo, status: "BOXES_ASSIGNED" })

    const updated = await prisma.tripManifest.findUnique({ where: { id }, include: TRIP_INCLUDE })
    res.json({ success: true, data: updated, message: `Box ${box.boxNumber} assigned to trip ${trip.tripNo}` })
  } catch (err) { next(err) }
}

export async function unpairBox(req, res, next) {
  try {
    const { id, boxId } = req.params
    const box = await prisma.consolidationBox.findUnique({ where: { id: boxId } })
    if (!box || box.tripManifestId !== id) return res.status(404).json({ success: false, message: "Box not found on this trip" })

    await prisma.consolidationBox.update({ where: { id: boxId }, data: { tripManifestId: null, status: "PACKED" } })
    emitToBox(boxId, "box:status_changed", { boxId, boxNumber: box.boxNumber, status: "PACKED", previousStatus: box.status })
    res.json({ success: true, message: "Box removed from trip" })
  } catch (err) { next(err) }
}

export async function updateTripStatus(req, res, next) {
  try {
    const { id } = req.params
    const data = updateTripStatusSchema.parse(req.body)

    const trip = await prisma.tripManifest.findUnique({ where: { id }, include: { boxes: true } })
    if (!trip) return res.status(404).json({ success: false, message: "Trip manifest not found" })

    const now = new Date()
    const updateData = { status: data.status }
    let boxStatus = null
    if (data.status === "DEPARTED") { updateData.departureStatus = "DEPARTED"; updateData.departedAt = now; boxStatus = "DEPARTED" }
    if (data.status === "ARRIVED") { updateData.arrivalStatus = "ARRIVED"; updateData.arrivedAt = now; boxStatus = "ARRIVED_TZ" }

    await prisma.tripManifest.update({ where: { id }, data: updateData })

    if (boxStatus) {
      await prisma.consolidationBox.updateMany({ where: { tripManifestId: id }, data: { status: boxStatus } })
      for (const box of trip.boxes) {
        emitToBox(box.id, "box:status_changed", { boxId: box.id, boxNumber: box.boxNumber, status: boxStatus, previousStatus: box.status })
      }
    }

    emitToTrip(id, "trip:updated", { tripManifestId: id, tripNo: trip.tripNo, status: data.status })

    const updated = await prisma.tripManifest.findUnique({ where: { id }, include: TRIP_INCLUDE })
    res.json({ success: true, data: updated, message: `Trip ${trip.tripNo} marked ${data.status}` })
  } catch (err) { next(err) }
}
