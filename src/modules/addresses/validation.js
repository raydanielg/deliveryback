import { z } from "zod"

export const addressSchema = z.object({
  label: z.string().max(50).optional(),
  fullName: z.string().min(2).max(150),
  phone: z.string().min(6).max(20),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(2).max(100),
  region: z.string().max(100).optional(),
  district: z.string().max(100).optional(),
  country: z.string().min(2).max(100).default("Tanzania"),
  postalCode: z.string().max(20).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isDefault: z.boolean().optional(),
})

export const updateAddressSchema = addressSchema.partial()
