import { z } from "zod"

export const createParcelCategorySchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional().or(z.literal("")).transform(v => v === "" ? undefined : v),
  image: z.string().url().optional().or(z.literal("")).transform(v => v === "" ? undefined : v),
  isActive: z.boolean().default(true),
})
