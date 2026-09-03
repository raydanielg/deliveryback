import { z } from "zod"

export const calculateQuoteSchema = z.object({
  category: z.enum(["DOMESTIC", "INTERNATIONAL", "SPECIAL_TRANSPORT"]),
  transportMode: z.enum(["ROAD", "AIR", "SEA", "COURIER", "RAIL"]).optional(),
  serviceLevel: z.enum(["STANDARD", "EXPRESS", "SAME_DAY", "NEXT_DAY", "ECONOMY", "PRIORITY"]).optional(),
  originCity: z.string().min(1),
  destinationCity: z.string().min(1),
  originCountry: z.string().default("Tanzania"),
  destCountry: z.string().default("Tanzania"),
  distanceKm: z.number().min(0).optional().default(0),
  actualWeightKg: z.number().min(0.01),
  lengthCm: z.number().min(0).optional(),
  widthCm: z.number().min(0).optional(),
  heightCm: z.number().min(0).optional(),
  routeId: z.string().optional(),
  zoneId: z.string().optional(),
  countryId: z.string().optional(),
  insuranceEnabled: z.boolean().optional().default(false),
  declaredValue: z.number().min(0).optional().default(0),
  currency: z.string().default("TZS"),
})

export const createQuoteRequestSchema = z.object({
  category: z.enum(["DOMESTIC", "INTERNATIONAL", "SPECIAL_TRANSPORT"]),
  transportMode: z.enum(["ROAD", "AIR", "SEA", "COURIER", "RAIL"]).optional(),
  originCity: z.string().min(1),
  destinationCity: z.string().min(1),
  originCountry: z.string().default("Tanzania"),
  destCountry: z.string().default("Tanzania"),
  weightKg: z.number().min(0.01),
  lengthCm: z.number().min(0).optional(),
  widthCm: z.number().min(0).optional(),
  heightCm: z.number().min(0).optional(),
  description: z.string().optional(),
  specialHandling: z.string().optional(),
})

export const respondToQuoteRequestSchema = z.object({
  quotedPrice: z.number().min(0),
  quotedCurrency: z.string().default("TZS"),
  validityDays: z.number().int().min(1).max(90).default(7),
  adminNotes: z.string().optional(),
})

export const customerRespondSchema = z.object({
  action: z.enum(["ACCEPT", "REJECT", "REQUEST_REVISION"]),
})
