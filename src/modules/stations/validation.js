import { z } from "zod"

export const createStationSchema = z.object({
  name: z.string().min(2).max(200),
  code: z.string().min(2).max(20).toUpperCase(),
  type: z.enum(["SGR_STATION", "WAREHOUSE", "HUB", "DROP_POINT", "AIRPORT_CARGO"]).default("SGR_STATION"),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  managerName: z.string().max(100).optional(),
  capacityKg: z.number().positive().optional(),
  isActive: z.boolean().default(true),
})

export const receiveShipmentSchema = z.object({
  trackingNumber: z.string().min(1),
  notes: z.string().max(500).optional(),
})

export const dispatchInventorySchema = z.object({
  inventoryId: z.string().min(1),
  notes: z.string().max(500).optional(),
})
