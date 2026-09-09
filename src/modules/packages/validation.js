import { z } from "zod"

export const scanPackageSchema = z.object({
  barcode: z.string().min(3),
  status: z.enum([
    "SCANNED_AT_PICKUP", "SCANNED_AT_WAREHOUSE", "LOADED", "DEPARTED",
    "ARRIVED", "OUT_FOR_DELIVERY", "DELIVERED", "DAMAGED", "LOST",
  ]),
  location: z.string().optional(),
  notes: z.string().optional(),
})
