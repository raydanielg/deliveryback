import { z } from "zod"

export const createZoneSchema = z.object({
  countryId: z.string().min(1),
  regionId: z.string().optional(),
  cityId: z.string().optional(),
  name: z.string().min(2).max(100),
  code: z.string().max(20).optional(),
  isActive: z.boolean().default(true),
})
