import { z } from "zod"

export const receiveTzSchema = z.object({
  trackingNumber: z.string().min(1),
  boxNumber: z.string().optional(),
  tripNo: z.string().optional(),
  notes: z.string().max(500).optional(),
})
