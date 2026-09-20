import prisma from "../../prisma/client.js"
import { emitToShipment } from "../../realtime/socket.js"
import { logAction } from "../../middleware/audit-logger.js"
import { receiveTzSchema } from "./validation.js"

// Goods_Received_TZ equivalent — arrival at the Tanzania distribution center. Starts the
// free-storage clock (Shipment.storageStartAt) that payment-approvals later charges against.
// Spec Module 5: TZ weight is compared against the Dubai-declared weight — a difference
// over 0.5 KG raises a discrepancy flag; DAMAGED requires a photo.
export async function receiveTz(req, res, next) {
  try {
    const data = receiveTzSchema.parse(req.body)

    if (data.condition === "DAMAGED" && !data.discrepancyPhotoUrl) {
      return res.status(400).json({ success: false, message: "A photo is required for damaged goods" })
    }

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

    // Auto-detect weight discrepancy: TZ weight vs Dubai-declared weight (> 0.5 KG).
    let discrepancyCode = data.discrepancyCode || null
    let discrepancyNotes = data.discrepancyNotes || null
    if (data.weightKgTz !== undefined) {
      const diff = Math.abs(data.weightKgTz - Number(shipment.actualWeightKg))
      if (diff > 0.5 && !discrepancyCode) {
        discrepancyCode = "WEIGHT_MISMATCH"
        discrepancyNotes = discrepancyNotes || `Dubai declared ${shipment.actualWeightKg} KG, TZ weighed ${data.weightKgTz} KG (diff ${diff.toFixed(2)} KG)`
      }
    }
    if (data.piecesCount !== undefined && shipment.piecesCount && data.piecesCount !== shipment.piecesCount && !discrepancyCode) {
      discrepancyCode = "PIECES_MISSING"
      discrepancyNotes = discrepancyNotes || `Dubai declared ${shipment.piecesCount} pieces, TZ counted ${data.piecesCount}`
    }
    if (data.condition !== "GOOD" && !discrepancyCode && data.condition === "DAMAGED") {
      discrepancyCode = "DAMAGED_IN_TRANSIT"
    }

    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: "ARRIVED_TANZANIA",
        storageStartAt: new Date(),
        ...(data.weightKgTz !== undefined ? { weightKgTz: data.weightKgTz } : {}),
        condition: data.condition,
        discrepancyCode,
        discrepancyNotes,
        discrepancyPhotoUrl: data.discrepancyPhotoUrl || null,
        lastMovementAt: new Date(),
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id, event: "GOODS_RECEIVED_TZ", status: "ARRIVED_TANZANIA",
        description: `Goods received at Tanzania distribution center — condition ${data.condition}${discrepancyCode ? ` · discrepancy: ${discrepancyCode}` : ""}${data.notes ? ` — ${data.notes}` : ""}`,
        createdBy: req.user.id,
      },
    })

    emitToShipment(shipment.id, "shipment:status_changed", {
      shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, status: "ARRIVED_TANZANIA", previousStatus: shipment.status,
    })

    await logAction({
      userId: req.user.id, action: "RECEIVE_TZ", entity: "Shipment", entityId: shipment.id,
      changes: {
        trackingNumber: shipment.trackingNumber, condition: data.condition,
        weightKgDubai: shipment.actualWeightKg, weightKgTz: data.weightKgTz,
        discrepancyCode: discrepancyCode || null,
      }, req,
    })

    res.json({
      success: true,
      data: updated,
      message: discrepancyCode
        ? `Goods received — discrepancy flagged: ${discrepancyCode}`
        : "Goods received at Tanzania — storage clock started",
    })
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
