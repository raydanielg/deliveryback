import { z } from "zod"

export const createClaimSchema = z.object({
  shipmentId: z.string(),
  type: z.enum(["LOST", "DAMAGED", "MISSING_ITEM", "WRONG_DELIVERY", "DELAYED", "OTHER"]),
  description: z.string().min(10).max(2000),
  // multipart/form-data (when evidence files are attached) sends numbers as strings.
  claimedAmount: z.coerce.number().min(0).optional(),
  evidenceUrls: z.array(z.string()).optional(),
})

export const updateClaimStatusSchema = z.object({
  status: z.enum(["OPEN", "UNDER_REVIEW", "INVESTIGATION", "APPROVED", "REJECTED", "RESOLUTION", "CLOSED"]),
  resolution: z.string().max(2000).optional(),
  resolvedAmount: z.number().min(0).optional(),
})

export const assignClaimSchema = z.object({
  assignedToId: z.string(),
})
