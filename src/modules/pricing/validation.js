import { z } from "zod"

export const createPricingRuleSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(50),
  type: z.enum([
    "DISTANCE", "WEIGHT", "VOLUMETRIC", "ROUTE",
    "ZONE", "COUNTRY", "TRANSPORT", "SERVICE", "FLAT", "CUSTOM",
  ]),
  category: z.enum(["DOMESTIC", "INTERNATIONAL", "SPECIAL_TRANSPORT"]).optional(),
  transportMode: z.enum(["ROAD", "AIR", "SEA", "COURIER", "RAIL"]).optional(),
  serviceLevel: z.enum(["STANDARD", "EXPRESS", "SAME_DAY", "NEXT_DAY", "ECONOMY", "PRIORITY"]).optional(),
  routeId: z.string().optional(),
  zoneId: z.string().optional(),
  countryId: z.string().optional(),
  baseFare: z.number().min(0).default(0),
  perKg: z.number().min(0).optional(),
  perKm: z.number().min(0).optional(),
  perM3: z.number().min(0).optional(),
  minCharge: z.number().min(0).optional(),
  maxCharge: z.number().min(0).optional(),
  weightTiers: z.array(z.object({
    min: z.number(),
    max: z.number().optional(),
    price: z.number(),
  })).optional(),
  conditions: z.record(z.any()).optional(),
  priority: z.number().int().default(0),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
})

export const createSurchargeSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(50),
  type: z.enum([
    "FUEL_SURCHARGE", "HANDLING_FEE", "LOADING_FEE", "UNLOADING_FEE",
    "WAREHOUSE_FEE", "INSURANCE", "CUSTOMS_HANDLING", "REMOTE_AREA_FEE",
    "FRAGILE_FEE", "OVERSIZE_FEE", "EXPRESS_FEE", "WEEKEND_FEE", "TAX", "OTHER",
  ]),
  calculation: z.enum(["FIXED", "PERCENTAGE", "PER_KG", "PER_KM"]).default("FIXED"),
  value: z.number().min(0),
  appliesTo: z.string().optional(),
  pricingRuleId: z.string().optional(),
})
