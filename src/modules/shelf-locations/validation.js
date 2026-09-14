import { z } from "zod"

export const createShelfSchema = z.object({
  stationId: z.string().min(1),
  code: z.string().min(1).max(50),
  rack: z.string().optional(),
  shelfLevel: z.string().optional(),
  bin: z.string().optional(),
  capacityBoxes: z.number().int().positive().optional(),
})

export const assignBoxToShelfSchema = z.object({
  boxId: z.string().min(1),
})

export const assignShipmentToShelfSchema = z.object({
  shipmentId: z.string().min(1),
})
