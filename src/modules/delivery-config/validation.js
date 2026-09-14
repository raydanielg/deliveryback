import { z } from "zod"

export const zoneSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  feeAmount: z.number().nonnegative(),
  currency: z.string().optional(),
})

export const storageSettingsSchema = z.object({
  storageRatePerDayTzs: z.number().nonnegative().optional(),
  freeStorageDays: z.number().int().nonnegative().optional(),
  defaultBoxTargetKg: z.number().positive().optional(),
})
