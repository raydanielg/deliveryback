import prisma from "../../prisma/client.js"
import { createExceptionSchema, updateExceptionSchema, createReturnSchema } from "./validation.js"
import { triggerStatusNotification } from "../notification-service/controller.js"

export async function listExceptions(req, res, next) {
  try {
    const { status, type, stationId, page = 1, limit = 50 } = req.query
    const where = {}
    if (status) where.status = status
    if (type) where.type = type
    if (stationId) where.stationId = stationId

    const exceptions = await prisma.shipmentException.findMany({
      where,
      include: {
        shipment: {
          select: {
            id: true, trackingNumber: true, status: true, chargeableWeightKg: true,
            order: { select: { senderName: true, receiverName: true, receiverPhone: true } },
          },
        },
        station: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
    })
    const total = await prisma.shipmentException.count({ where })

    res.json({ success: true, data: exceptions, total })
  } catch (err) { next(err) }
}

export async function getException(req, res, next) {
  try {
    const { id } = req.params
    const exception = await prisma.shipmentException.findUnique({
      where: { id },
      include: {
        shipment: {
          select: {
            id: true, trackingNumber: true, status: true, chargeableWeightKg: true,
            order: { select: { senderName: true, receiverName: true, receiverPhone: true, description: true } },
          },
        },
        station: { select: { id: true, name: true, code: true } },
      },
    })
    if (!exception) return res.status(404).json({ success: false, message: "Exception not found" })
    res.json({ success: true, data: exception })
  } catch (err) { next(err) }
}

export async function createException(req, res, next) {
  try {
    const data = createExceptionSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const exception = await prisma.shipmentException.create({
      data: {
        shipmentId: data.shipmentId,
        stationId: data.stationId,
        type: data.type,
        reason: data.reason,
        description: data.description,
      },
    })

    res.status(201).json({ success: true, data: exception, message: "Exception created" })
  } catch (err) { next(err) }
}

export async function updateException(req, res, next) {
  try {
    const { id } = req.params
    const data = updateExceptionSchema.parse(req.body)

    const updateData = { ...data }
    if (data.status === "RESOLVED" || data.status === "CLOSED") {
      updateData.resolvedAt = new Date()
      updateData.resolvedBy = req.user.id
    }

    const exception = await prisma.shipmentException.update({
      where: { id },
      data: updateData,
    })

    res.json({ success: true, data: exception })
  } catch (err) { next(err) }
}

export async function createReturn(req, res, next) {
  try {
    const data = createReturnSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const exception = await prisma.shipmentException.create({
      data: {
        shipmentId: data.shipmentId,
        stationId: data.stationId,
        type: "RETURN_REQUEST",
        reason: data.reason,
        description: data.description,
      },
    })

    await prisma.shipment.update({
      where: { id: data.shipmentId },
      data: { status: "RETURNING" },
    })

    await triggerStatusNotification(data.shipmentId, "RETURNING")

    res.status(201).json({ success: true, data: exception, message: "Return request created" })
  } catch (err) { next(err) }
}

export async function resolveException(req, res, next) {
  try {
    const { id } = req.params
    const { resolution } = req.body

    const exception = await prisma.shipmentException.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolution,
        resolvedAt: new Date(),
        resolvedBy: req.user.id,
      },
    })

    res.json({ success: true, data: exception, message: "Exception resolved" })
  } catch (err) { next(err) }
}

export async function escalateException(req, res, next) {
  try {
    const { id } = req.params
    const exception = await prisma.shipmentException.update({
      where: { id },
      data: { status: "ESCALATED" },
    })
    res.json({ success: true, data: exception, message: "Exception escalated" })
  } catch (err) { next(err) }
}

export async function getExceptionStats(req, res, next) {
  try {
    const byStatus = await prisma.shipmentException.groupBy({
      by: ["status"],
      _count: { status: true },
    })
    const byType = await prisma.shipmentException.groupBy({
      by: ["type"],
      _count: { type: true },
    })
    const total = await prisma.shipmentException.count()
    const open = await prisma.shipmentException.count({ where: { status: "OPEN" } })
    const resolved = await prisma.shipmentException.count({ where: { status: "RESOLVED" } })

    res.json({ success: true, data: { total, open, resolved, byStatus, byType } })
  } catch (err) { next(err) }
}
