import { z } from "zod"

export const createInvoiceSchema = z.object({
  shipmentId: z.string().min(1),
  freightCharges: z.number().nonnegative(),
  remarks: z.string().max(500).optional(),
})

export const bulkInvoiceSchema = z.object({
  shipmentIds: z.array(z.string().min(1)).min(1).max(200),
  freightCharges: z.number().nonnegative().optional(), // same rate applied to all when provided
})

export const recordPaymentSchema = z.object({
  paymentMethod: z.enum(["NMB", "CRDB", "MPESA", "TIGOPESA", "AIRTEL_MONEY", "MOBILE_MONEY", "BANK_TRANSFER", "CASH", "CARD", "WALLET", "CREDIT", "MANUAL"]),
  paidAt: z.string().datetime().optional(),
  remarks: z.string().max(500).optional(),
})

export const reopenInvoiceSchema = z.object({
  reason: z.string().min(1).max(500),
})
