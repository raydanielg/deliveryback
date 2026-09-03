import { z } from "zod"

export const createPaymentGatewaySchema = z.object({
  name: z.string().min(2).max(100),
  gateway: z.string().min(2).max(50),
  mode: z.enum(["test", "live"]).default("test"),
  liveValues: z.record(z.any()).optional(),
  testValues: z.record(z.any()).optional(),
  additionalData: z.record(z.any()).optional(),
  isActive: z.boolean().default(true),
})

export const initiatePaymentSchema = z.object({
  orderId: z.string(),
  gateway: z.string(),
  amount: z.number().min(1),
  currency: z.string().default("TZS"),
  payerPhone: z.string().optional(),
  payerEmail: z.string().optional(),
  payerName: z.string().optional(),
  redirectUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
})
