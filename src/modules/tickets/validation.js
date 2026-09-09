import { z } from "zod"

export const createTicketSchema = z.object({
  subject: z.string().min(3).max(200),
  message: z.string().min(3).max(4000),
  shipmentId: z.string().optional(),
})

export const updateTicketStatusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
})

export const assignTicketSchema = z.object({
  assignedToId: z.string(),
})

export const createReplySchema = z.object({
  message: z.string().min(1).max(4000),
})
