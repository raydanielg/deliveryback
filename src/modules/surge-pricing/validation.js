import { z } from "zod"

export const createSurgePricingSchema = z.object({
  name: z.string().min(2).max(100),
  surgePercentage: z.number().min(0).max(500),
  isActive: z.boolean().default(true),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  timeSlots: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string(),
    endTime: z.string(),
  })).optional(),
})
