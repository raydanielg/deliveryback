import { z } from "zod"

export const ITEM_TYPES = [
  "ELECTRONICS",
  "GENERAL_CARGO",
  "ELI",
  "ONLINE_PARCEL",
  "SPARE_PARTS",
  "TV",
  "COSMETICS",
  "MIX_ITEMS",
  "OTHERS",
]

export const RECEIVED_LOCATIONS = ["DUBAI_OFFICE", "DUBAI_WAREHOUSE"]

export const receiveDubaiSchema = z.object({
  customerName: z.string().min(2, "Customer name is required").max(120),
  customerPhone: z.string().min(9, "Enter a valid phone").max(20),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  supplierName: z.string().max(120).optional(),
  itemDescription: z.string().min(1, "Item description is required").max(500),
  itemType: z.enum(ITEM_TYPES),
  weightKg: z.number().positive("Weight must be greater than 0"),
  piecesCount: z.number().int().positive("Pieces must be at least 1"),
  piecesUnit: z.enum(["BOX", "PARCEL"]),
  receivedLocation: z.enum(RECEIVED_LOCATIONS),
  deliveryOption: z
    .enum(["COLLECT_AT_TAZARA_FREE", "COLLECT_AT_OTHER_POINT_CHARGED", "HOME_OFFICE_DELIVERY_CHARGED"])
    .optional(),
  deliveryZoneId: z.string().optional(),
  remarks: z.string().max(500).optional(),
})

export const updateDubaiReceivingSchema = receiveDubaiSchema.partial()

export const supplierSchema = z.object({
  name: z.string().min(1).max(120),
  contact: z.string().max(120).optional(),
  isActive: z.boolean().optional(),
})
