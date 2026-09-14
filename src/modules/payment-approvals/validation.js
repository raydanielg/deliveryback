import { z } from "zod"

export const requestApprovalSchema = z.object({
  shipmentId: z.string().min(1),
})

export const rejectApprovalSchema = z.object({
  reason: z.string().min(1).max(500),
})
