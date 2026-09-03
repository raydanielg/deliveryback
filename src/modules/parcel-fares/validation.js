import { z } from "zod"

export const createParcelFareSchema = z.object({
  zoneId: z.string().optional(),
  baseFare: z.number().min(0).default(0),
  returnFee: z.number().min(0).default(0),
  cancellationFee: z.number().min(0).default(0),
  baseFarePerKm: z.number().min(0).default(0),
  cancellationFeePercent: z.number().min(0).max(100).default(0),
  minCancellationFee: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
})

export const createParcelFareWeightSchema = z.object({
  parcelFareId: z.string(),
  parcelWeightId: z.string(),
  parcelCategoryId: z.string().optional(),
  baseFare: z.number().min(0).default(0),
  returnFee: z.number().min(0).default(0),
  cancellationFee: z.number().min(0).default(0),
  farePerKm: z.number().min(0).default(0),
  zoneId: z.string().optional(),
})
