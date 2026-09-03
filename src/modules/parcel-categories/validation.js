import { z } from "zod"

export const createParcelCategorySchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  image: z.string().url().optional(),
  isActive: z.boolean().default(true),
})
