import { z } from "zod"

export const receiveAtWarehouseSchema = z.object({
  trackingNumber: z.string().min(1),
  notes: z.string().max(500).optional(),
})

export const verifyAndWeighSchema = z.object({
  shipmentId: z.string().min(1),
  actualWeightKg: z.number().positive(),
  notes: z.string().max(500).optional(),
})

export const assignShelfBinSchema = z.object({
  shipmentId: z.string().min(1),
  shelfBinLocation: z.string().min(1).max(50),
})

export const consolidateByRouteSchema = z.object({
  shipmentIds: z.array(z.string()).min(1),
  routeLabel: z.string().min(1),
  notes: z.string().optional(),
})

export const releaseShipmentSchema = z.object({
  shipmentId: z.string().min(1),
  recipientName: z.string().min(1),
  recipientIdType: z.string().optional(),
  recipientIdNumber: z.string().optional(),
  otp: z.string().optional(),
  notes: z.string().max(500).optional(),
})
