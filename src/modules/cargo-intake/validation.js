import { z } from "zod"

export const DISCREPANCY_CODES = [
  "WEIGHT_MISMATCH",
  "PIECES_MISSING",
  "WRONG_CUSTOMER",
  "DAMAGED_IN_TRANSIT",
  "BOX_OPENED",
]

export const ITEM_CONDITIONS = ["GOOD", "DAMAGED", "INCOMPLETE", "SUSPICIOUS"]

export const receiveTzSchema = z.object({
  trackingNumber: z.string().min(1),
  boxNumber: z.string().optional(),
  tripNo: z.string().optional(),
  weightKgTz: z.number().positive().optional(),
  piecesCount: z.number().int().positive().optional(),
  condition: z.enum(ITEM_CONDITIONS).default("GOOD"),
  discrepancyCode: z.enum(DISCREPANCY_CODES).optional(),
  discrepancyNotes: z.string().max(500).optional(),
  discrepancyPhotoUrl: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
})
