import { z } from "zod"

export const createBoxSchema = z.object({
  originStationId: z.string().min(1),
  targetWeightKg: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
})

export const addBoxItemSchema = z.object({
  trackingNumber: z.string().min(1),
  notes: z.string().max(500).optional(),
})

export const closeBoxSchema = z.object({
  actualWeightKg: z.number().positive(),
})

export const boxStatusSchema = z.object({
  status: z.enum(["LOST", "DAMAGED"]),
  notes: z.string().max(500).optional(),
})
