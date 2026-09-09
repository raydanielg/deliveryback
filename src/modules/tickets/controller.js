import prisma from "../../prisma/client.js"
import { createTicketSchema, updateTicketStatusSchema, assignTicketSchema, createReplySchema } from "./validation.js"
import { createNotification } from "../notifications/controller.js"

function generateTicketNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  return `TKT-${year}-${random}`
}

const TICKET_INCLUDE = {
  customer: { select: { id: true, name: true, email: true, phone: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  shipment: { select: { id: true, trackingNumber: true, status: true } },
  replies: {
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, role: true } } },
  },
}

export async function listTickets(req, res, next) {
  try {
    const { status, page = 1, limit = 50 } = req.query
    const where = {}
    if (status) where.status = status
    if (req.user?.role === "CUSTOMER") where.customerId = req.user.id

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, email: true } },
          assignedTo: { select: { id: true, name: true } },
          shipment: { select: { id: true, trackingNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        take: Number(limit),
        skip: (Number(page) - 1) * Number(limit),
      }),
      prisma.supportTicket.count({ where }),
    ])

    res.json({ success: true, data: tickets, meta: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) } })
  } catch (err) { next(err) }
}

export async function getTicket(req, res, next) {
  try {
    const { id } = req.params
    const ticket = await prisma.supportTicket.findUnique({ where: { id }, include: TICKET_INCLUDE })
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" })
    if (req.user?.role === "CUSTOMER" && ticket.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: "You do not have access to this ticket" })
    }
    res.json({ success: true, data: ticket })
  } catch (err) { next(err) }
}

export async function createTicket(req, res, next) {
  try {
    const data = createTicketSchema.parse(req.body)

    if (data.shipmentId) {
      const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } })
      if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })
      if (req.user.role === "CUSTOMER" && shipment.createdById !== req.user.id) {
        return res.status(403).json({ success: false, message: "You can only reference your own shipments" })
      }
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber: generateTicketNumber(),
        customerId: req.user.id,
        subject: data.subject,
        message: data.message,
        shipmentId: data.shipmentId,
      },
      include: TICKET_INCLUDE,
    })

    res.status(201).json({ success: true, data: ticket, message: "Support ticket created" })
  } catch (err) { next(err) }
}

export async function updateTicketStatus(req, res, next) {
  try {
    const { id } = req.params
    const data = updateTicketStatusSchema.parse(req.body)

    const ticket = await prisma.supportTicket.findUnique({ where: { id } })
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" })

    const updateData = { status: data.status }
    if (["RESOLVED", "CLOSED"].includes(data.status) && !ticket.resolvedAt) {
      updateData.resolvedAt = new Date()
    }

    const updated = await prisma.supportTicket.update({ where: { id }, data: updateData, include: TICKET_INCLUDE })

    try {
      await createNotification(
        ticket.customerId,
        "TICKET_UPDATED",
        "Support Ticket Updated",
        `Your ticket ${ticket.ticketNumber} is now ${data.status.replace(/_/g, " ").toLowerCase()}.`,
        { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, status: data.status }
      )
    } catch (notifErr) {
      console.warn("Ticket notification failed:", notifErr.message)
    }

    res.json({ success: true, data: updated, message: "Ticket updated" })
  } catch (err) { next(err) }
}

export async function assignTicket(req, res, next) {
  try {
    const { id } = req.params
    const data = assignTicketSchema.parse(req.body)

    const ticket = await prisma.supportTicket.findUnique({ where: { id } })
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" })

    const assignee = await prisma.user.findUnique({ where: { id: data.assignedToId } })
    if (!assignee) return res.status(404).json({ success: false, message: "Assignee not found" })

    const updated = await prisma.supportTicket.update({
      where: { id },
      data: { assignedToId: data.assignedToId, status: ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status },
      include: TICKET_INCLUDE,
    })

    res.json({ success: true, data: updated, message: "Ticket assigned" })
  } catch (err) { next(err) }
}

export async function createReply(req, res, next) {
  try {
    const { id } = req.params
    const data = createReplySchema.parse(req.body)

    const ticket = await prisma.supportTicket.findUnique({ where: { id } })
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" })
    if (req.user.role === "CUSTOMER" && ticket.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: "You do not have access to this ticket" })
    }

    const reply = await prisma.ticketReply.create({
      data: { ticketId: id, authorId: req.user.id, message: data.message },
      include: { author: { select: { id: true, name: true, role: true } } },
    })

    // A staff reply nudges an OPEN ticket into progress; a customer reply re-opens a
    // resolved/closed one instead of leaving it stuck as "done" with unread follow-up.
    if (req.user.role !== "CUSTOMER" && ticket.status === "OPEN") {
      await prisma.supportTicket.update({ where: { id }, data: { status: "IN_PROGRESS" } })
    } else if (req.user.role === "CUSTOMER" && ["RESOLVED", "CLOSED"].includes(ticket.status)) {
      await prisma.supportTicket.update({ where: { id }, data: { status: "OPEN", resolvedAt: null } })
    }

    const notifyUserId = req.user.role === "CUSTOMER" ? ticket.assignedToId : ticket.customerId
    if (notifyUserId) {
      try {
        await createNotification(
          notifyUserId,
          "TICKET_REPLY",
          "New Reply on Support Ticket",
          `${req.user.name || "Someone"} replied to ticket ${ticket.ticketNumber}.`,
          { ticketId: ticket.id, ticketNumber: ticket.ticketNumber }
        )
      } catch (notifErr) {
        console.warn("Ticket reply notification failed:", notifErr.message)
      }
    }

    res.status(201).json({ success: true, data: reply, message: "Reply added" })
  } catch (err) { next(err) }
}

export async function getTicketStats(req, res, next) {
  try {
    const [byStatus, total, open] = await Promise.all([
      prisma.supportTicket.groupBy({ by: ["status"], _count: { status: true } }),
      prisma.supportTicket.count(),
      prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    ])
    res.json({ success: true, data: { total, open, byStatus } })
  } catch (err) { next(err) }
}
