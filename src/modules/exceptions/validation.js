import { z } from "zod"

export const createExceptionSchema = z.object({
  shipmentId: z.string().min(1),
  stationId: z.string().optional(),
  type: z.enum([
    "MISSED_SCAN", "DAMAGED", "LOST", "WRONG_DESTINATION",
    "OVERWEIGHT", "UNCLAIMED", "RETURN_REQUEST", "CUSTOMER_REFUSAL",
  ]),
  reason: z.string().min(2).max(500),
  description: z.string().max(2000).optional(),
})

export const updateExceptionSchema = z.object({
  status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "ESCALATED", "CLOSED"]).optional(),
  resolution: z.string().max(2000).optional(),
})

export const createReturnSchema = z.object({
  shipmentId: z.string().min(1),
  reason: z.string().min(2).max(500),
  stationId: z.string().optional(),
  description: z.string().max(2000).optional(),
})
