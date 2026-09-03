import { z } from "zod"

export const createParcelWeightSchema = z.object({
  minWeight: z.number().min(0),
  maxWeight: z.number().min(0),
  isActive: z.boolean().default(true),
})
