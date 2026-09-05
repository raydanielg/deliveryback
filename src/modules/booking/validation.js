import { z } from "zod"

export const cargoTypes = [
  "DOCUMENT",
  "PARCEL",
  "COMMERCIAL_CARGO",
  "ECOMMERCE_ORDER",
  "PALLET",
  "PERISHABLE_CARGO",
  "FRAGILE_CARGO",
  "MACHINERY_EQUIPMENT",
  "OTHER",
]

export const universalBookingSchema = z.object({
  cargoType: z.enum(cargoTypes),
  description: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  weightKg: z.number().min(0.01),
  lengthCm: z.number().min(0).optional(),
  widthCm: z.number().min(0).optional(),
  heightCm: z.number().min(0).optional(),
  cargoValue: z.number().min(0).optional(),
  specialHandling: z.array(z.string()).default([]),
  photoUrl: z.string().optional(),

  fromAddress: z.object({
    fullName: z.string(),
    phone: z.string(),
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    region: z.string().optional(),
    district: z.string().optional(),
    country: z.string().default("Tanzania"),
    postalCode: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
  toAddress: z.object({
    fullName: z.string(),
    phone: z.string(),
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    region: z.string().optional(),
    district: z.string().optional(),
    country: z.string().default("Tanzania"),
    postalCode: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),

  serviceLevel: z.enum(["STANDARD", "EXPRESS", "SAME_DAY", "NEXT_DAY", "ECONOMY", "PRIORITY"]).default("STANDARD"),
  fulfillmentType: z.enum([
    "DOOR_TO_DOOR", "DOOR_TO_PICKUP", "PICKUP_TO_DOOR",
    "PICKUP_TO_PICKUP", "WAREHOUSE_TO_DOOR", "WAREHOUSE_TO_PICKUP",
  ]).default("DOOR_TO_DOOR"),

  // Optional overrides - customer can force a mode
  transportMode: z.enum(["ROAD", "AIR", "SEA", "COURIER", "RAIL"]).optional(),
  vehicleCategory: z.string().optional(),

  // SGR-specific
  sgrServiceType: z.enum(["STATION_TO_STATION", "DOOR_TO_STATION", "STATION_TO_DOOR", "DOOR_TO_DOOR"]).optional(),
  originStationId: z.string().optional(),
  destinationStationId: z.string().optional(),

  // Air Cargo-specific
  airCargoServiceType: z.enum(["AIRPORT_TO_AIRPORT", "DOOR_TO_AIRPORT", "AIRPORT_TO_DOOR", "DOOR_TO_DOOR"]).optional(),
  originAirport: z.string().optional(),
  destinationAirport: z.string().optional(),
  commodityType: z.string().optional(),
  dangerousGoodsDeclared: z.boolean().default(false),
  perishable: z.boolean().default(false),

  // Payment
  payer: z.enum(["SENDER", "RECEIVER", "COMPANY_ACCOUNT"]).default("SENDER"),
  paymentMethod: z.enum(["MOBILE_MONEY", "BANK_TRANSFER", "CARD", "CASH", "CREDIT", "WALLET"]).optional(),

  // Insurance
  insuranceEnabled: z.boolean().default(false),

  // Scheduling
  scheduledAt: z.string().datetime().optional(),
  isScheduled: z.boolean().default(false),

  // Prohibited goods declaration acceptance
  prohibitedGoodsAccepted: z.boolean().default(false),

  // Packages for multi-piece shipments
  packages: z.array(z.object({
    type: z.enum(["DOCUMENT", "PARCEL", "BOX", "BAG", "PALLET", "CRATE", "CARGO", "ENVELOPE", "OTHER"]),
    weightKg: z.number().min(0.01),
    lengthCm: z.number().optional(),
    widthCm: z.number().optional(),
    heightCm: z.number().optional(),
    declaredValue: z.number().optional(),
    description: z.string().optional(),
    isFragile: z.boolean().default(false),
  })).optional(),
})

export const recommendModeSchema = z.object({
  weightKg: z.number().min(0.01),
  lengthCm: z.number().min(0).optional(),
  widthCm: z.number().min(0).optional(),
  heightCm: z.number().min(0).optional(),
  originCity: z.string(),
  destinationCity: z.string(),
  originCountry: z.string().default("Tanzania"),
  destCountry: z.string().default("Tanzania"),
  cargoType: z.enum(cargoTypes).optional(),
  serviceLevel: z.enum(["STANDARD", "EXPRESS", "SAME_DAY", "NEXT_DAY", "ECONOMY", "PRIORITY"]).optional(),
})

export const bulkBookingSchema = z.object({
  shipments: z.array(universalBookingSchema).min(1).max(500),
})
