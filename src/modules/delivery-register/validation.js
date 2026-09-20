import { z } from "zod"

export const createDeliverySchema = z.object({
  shipmentId: z.string().min(1),
  driverId: z.string().min(1),
  vehicleId: z.string().optional(),
  zoneId: z.string().optional(),
  deliveryFee: z.number().nonnegative().optional(), // defaults to zone fee; override needs reason + manager
  feeOverrideReason: z.string().max(500).optional(),
  address: z.string().min(1),
})

export const completeDeliverySchema = z.object({
  receiverName: z.string().min(1),
  receiverOtp: z.string().optional(),
  receiverSignatureUrl: z.string().url().optional(),
  driverSignatureUrl: z.string().optional(),
  deliveredAt: z.string().datetime().optional(),
})

export const failDeliverySchema = z.object({
  reason: z.string().min(1).max(500),
})

export const approveFeeSchema = z.object({
  approved: z.boolean(),
  reason: z.string().max(500).optional(),
})
