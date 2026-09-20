import prisma from "../../prisma/client.js"
import { emitToRole, emitToShipment } from "../../realtime/socket.js"
import { computeCharges } from "../delivery-config/controller.js"
import { logAction } from "../../middleware/audit-logger.js"
import { requestApprovalSchema, rejectApprovalSchema } from "./validation.js"

const NOTIFY_ROLES = ["FINANCE", "OPERATIONS_MANAGER", "SUPER_ADMIN"]

export async function listApprovals(req, res, next) {
  try {
    const { approvalStatus } = req.query
    const where = {}
    if (approvalStatus) where.approvalStatus = approvalStatus

    const approvals = await prisma.paymentApproval.findMany({
      where,
      include: {
        shipment: { select: { id: true, trackingNumber: true, deliveryOption: true, currency: true } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: approvals })
  } catch (err) { next(err) }
}

export async function getApproval(req, res, next) {
  try {
    const approval = await prisma.paymentApproval.findUnique({
      where: { id: req.params.id },
      include: { shipment: true, requestedBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
    })
    if (!approval) return res.status(404).json({ success: false, message: "Payment approval not found" })
    res.json({ success: true, data: approval })
  } catch (err) { next(err) }
}

export async function requestApproval(req, res, next) {
  try {
    const data = requestApprovalSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId }, include: { deliveryZone: true } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const { storageCharge, deliveryFee, totalCharges } = await computeCharges(shipment)

    const approval = await prisma.paymentApproval.create({
      data: { shipmentId: shipment.id, storageCharge, deliveryFee, totalCharges, requestedById: req.user.id },
      include: { shipment: { select: { id: true, trackingNumber: true } } },
    })

    for (const role of NOTIFY_ROLES) {
      emitToRole(role, "payment:approval_requested", { approvalId: approval.id, shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, totalCharges })
    }

    res.status(201).json({ success: true, data: approval, message: `Payment approval requested: ${totalCharges} ${shipment.currency}` })
  } catch (err) { next(err) }
}

export async function approveApproval(req, res, next) {
  try {
    const { id } = req.params
    const approval = await prisma.paymentApproval.findUnique({ where: { id } })
    if (!approval) return res.status(404).json({ success: false, message: "Payment approval not found" })
    if (approval.approvalStatus !== "PENDING") return res.status(400).json({ success: false, message: `Already ${approval.approvalStatus}` })

    // R12 — the person who prepared/requested the approval cannot approve it themselves.
    if (approval.requestedById === req.user.id) {
      return res.status(403).json({ success: false, message: "You cannot approve a request you prepared — another approver must decide" })
    }

    const updated = await prisma.paymentApproval.update({
      where: { id }, data: { approvalStatus: "APPROVED", approvedById: req.user.id, approvedAt: new Date() },
    })

    emitToShipment(approval.shipmentId, "payment:approval_resolved", { approvalId: id, shipmentId: approval.shipmentId, approvalStatus: "APPROVED", approvedBy: req.user.name })

    await logAction({
      userId: req.user.id, action: "APPROVE_PAYMENT", entity: "PaymentApproval", entityId: id,
      changes: { shipmentId: approval.shipmentId, totalCharges: approval.totalCharges, requestedById: approval.requestedById }, req,
    })

    res.json({ success: true, data: updated, message: "Payment approved — shipment can now be released" })
  } catch (err) { next(err) }
}

export async function rejectApproval(req, res, next) {
  try {
    const { id } = req.params
    const data = rejectApprovalSchema.parse(req.body)

    const approval = await prisma.paymentApproval.findUnique({ where: { id } })
    if (!approval) return res.status(404).json({ success: false, message: "Payment approval not found" })
    if (approval.approvalStatus !== "PENDING") return res.status(400).json({ success: false, message: `Already ${approval.approvalStatus}` })

    // R12 — the person who prepared/requested the approval cannot reject it themselves either.
    if (approval.requestedById === req.user.id) {
      return res.status(403).json({ success: false, message: "You cannot reject a request you prepared — another approver must decide" })
    }

    const updated = await prisma.paymentApproval.update({
      where: { id }, data: { approvalStatus: "REJECTED", approvedById: req.user.id, approvedAt: new Date(), rejectionReason: data.reason },
    })

    emitToShipment(approval.shipmentId, "payment:approval_resolved", { approvalId: id, shipmentId: approval.shipmentId, approvalStatus: "REJECTED", approvedBy: req.user.name })

    await logAction({
      userId: req.user.id, action: "REJECT_PAYMENT", entity: "PaymentApproval", entityId: id,
      changes: { shipmentId: approval.shipmentId, totalCharges: approval.totalCharges, reason: data.reason }, req,
    })

    res.json({ success: true, data: updated, message: "Payment approval rejected" })
  } catch (err) { next(err) }
}
