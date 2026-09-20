import prisma from "../../prisma/client.js"
import { emitToBox, emitToTrip } from "../../realtime/socket.js"
import { logAction } from "../../middleware/audit-logger.js"
import { createTripSchema, pairBoxSchema, updateTripStatusSchema } from "./validation.js"

// TRIP-YYYY-NNN per spec Module 4 — sequential per year (the old Excel had a single
// TRIP-001 for everything). Looked up from the latest existing trip.
async function generateTripNo() {
  const yyyy = new Date().getFullYear()
  const prefix = `TRIP-${yyyy}-`
  const latest = await prisma.tripManifest.findFirst({
    where: { tripNo: { startsWith: prefix } },
    orderBy: { tripNo: "desc" },
    select: { tripNo: true },
  })
  const next = latest ? parseInt(latest.tripNo.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(next).padStart(3, "0")}`
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
    const tripNo = await generateTripNo()

    const trip = await prisma.tripManifest.create({
      data: { ...data, tripNo, qrPayload: `XRE-TRP-${tripNo}`, createdById: req.user.id },
      include: TRIP_INCLUDE,
    })
    await logAction({ userId: req.user.id, action: "CREATE_TRIP", entity: "TripManifest", entityId: trip.id, changes: { tripNo, flightDate: data.flightDate, passengerName: data.passengerName }, req })
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

    await logAction({ userId: req.user.id, action: "PAIR_BOX_TO_TRIP", entity: "TripManifest", entityId: id, changes: { tripNo: trip.tripNo, boxNumber: box.boxNumber }, req })
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
    await logAction({ userId: req.user.id, action: "UNPAIR_BOX_FROM_TRIP", entity: "TripManifest", entityId: id, changes: { boxNumber: box.boxNumber }, req })
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
    let shipmentStatus = null
    if (data.status === "DEPARTED") { updateData.departureStatus = "DEPARTED"; updateData.departedAt = now; boxStatus = "DEPARTED"; shipmentStatus = "DEPARTED_DUBAI" }
    if (data.status === "ARRIVED") { updateData.arrivalStatus = "ARRIVED"; updateData.arrivedAt = now; boxStatus = "ARRIVED_TZ"; shipmentStatus = "ARRIVED_TANZANIA" }

    await prisma.tripManifest.update({ where: { id }, data: updateData })

    if (boxStatus) {
      await prisma.consolidationBox.updateMany({ where: { tripManifestId: id }, data: { status: boxStatus } })
      for (const box of trip.boxes) {
        emitToBox(box.id, "box:status_changed", { boxId: box.id, boxNumber: box.boxNumber, status: boxStatus, previousStatus: box.status })
      }

      // Spec Module 4 — departing/arriving a trip moves every shipment inside its
      // boxes in a single action.
      if (shipmentStatus) {
        const boxIds = trip.boxes.map((b) => b.id)
        const items = await prisma.boxItem.findMany({ where: { boxId: { in: boxIds } }, select: { shipmentId: true } })
        const shipmentIds = items.map((i) => i.shipmentId)
        if (shipmentIds.length > 0) {
          await prisma.shipment.updateMany({ where: { id: { in: shipmentIds } }, data: { status: shipmentStatus, lastMovementAt: now } })
          await prisma.trackingEvent.createMany({
            data: shipmentIds.map((shipmentId) => ({
              shipmentId,
              event: data.status === "DEPARTED" ? "DEPARTED_DUBAI" : "ARRIVED_TANZANIA",
              status: shipmentStatus,
              description: `Trip ${trip.tripNo} ${data.status === "DEPARTED" ? "departed Dubai" : "arrived Tanzania"}`,
              createdBy: req.user.id,
            })),
          })
        }
      }
    }

    emitToTrip(id, "trip:updated", { tripManifestId: id, tripNo: trip.tripNo, status: data.status })

    await logAction({
      userId: req.user.id, action: `TRIP_${data.status}`, entity: "TripManifest", entityId: id,
      changes: { tripNo: trip.tripNo, status: data.status, boxesAffected: trip.boxes.length }, req,
    })

    const updated = await prisma.tripManifest.findUnique({ where: { id }, include: TRIP_INCLUDE })
    res.json({ success: true, data: updated, message: `Trip ${trip.tripNo} marked ${data.status}` })
  } catch (err) { next(err) }
}
