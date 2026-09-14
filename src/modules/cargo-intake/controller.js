import prisma from "../../prisma/client.js"
import { emitToShipment } from "../../realtime/socket.js"
import { receiveTzSchema } from "./validation.js"

// Goods_Received_TZ equivalent — arrival at the Tanzania distribution center. Starts the
// free-storage clock (Shipment.storageStartAt) that payment-approvals later charges against.
export async function receiveTz(req, res, next) {
  try {
    const data = receiveTzSchema.parse(req.body)

    const shipment = await prisma.shipment.findFirst({
      where: { trackingNumber: data.trackingNumber },
      include: { boxItems: { include: { box: { include: { tripManifest: true } } } } },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    // Cross-check the declared box/trip against what the shipment was actually consolidated
    // into, catching a mis-sorted parcel before it's marked received.
    if (data.boxNumber || data.tripNo) {
      const box = shipment.boxItems[0]?.box
      if (data.boxNumber && box?.boxNumber !== data.boxNumber) {
        return res.status(400).json({ success: false, message: `Declared box ${data.boxNumber} does not match this shipment's box (${box?.boxNumber || "none"})` })
      }
      if (data.tripNo && box?.tripManifest?.tripNo !== data.tripNo) {
        return res.status(400).json({ success: false, message: `Declared trip ${data.tripNo} does not match this shipment's trip (${box?.tripManifest?.tripNo || "none"})` })
      }
    }

    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: "RECEIVED_AT_STATION", storageStartAt: new Date() },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id, event: "GOODS_RECEIVED_TZ", status: "RECEIVED_AT_STATION",
        description: `Goods received at Tanzania distribution center${data.notes ? ` — ${data.notes}` : ""}`,
        createdBy: req.user.id,
      },
    })

    emitToShipment(shipment.id, "shipment:status_changed", {
      shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, status: "RECEIVED_AT_STATION", previousStatus: shipment.status,
    })

    res.json({ success: true, data: updated, message: "Goods received at Tanzania — storage clock started" })
  } catch (err) { next(err) }
}

export async function listPendingTz(req, res, next) {
  try {
    const boxes = await prisma.consolidationBox.findMany({
      where: { status: "ARRIVED_TZ" },
      include: {
        items: { include: { shipment: { select: { id: true, trackingNumber: true, status: true, storageStartAt: true } } } },
        tripManifest: { select: { tripNo: true, arrivedAt: true } },
      },
    })
    res.json({ success: true, data: boxes })
  } catch (err) { next(err) }
}
