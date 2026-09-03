import { z } from "zod"

export const createShipmentSchema = z.object({
  quoteId: z.string().optional(),
  category: z.enum(["DOMESTIC", "INTERNATIONAL", "SPECIAL_TRANSPORT"]),
  shipmentType: z.string().optional(),
  transportMode: z.enum(["ROAD", "AIR", "SEA", "COURIER", "RAIL"]).default("ROAD"),
  serviceLevel: z.enum(["STANDARD", "EXPRESS", "SAME_DAY", "NEXT_DAY", "ECONOMY", "PRIORITY"]).default("STANDARD"),
  fulfillmentType: z.enum([
    "DOOR_TO_DOOR", "DOOR_TO_PICKUP", "PICKUP_TO_DOOR",
    "PICKUP_TO_PICKUP", "WAREHOUSE_TO_DOOR", "WAREHOUSE_TO_PICKUP",
  ]).default("DOOR_TO_DOOR"),

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

  actualWeightKg: z.number().min(0.01),
  lengthCm: z.number().min(0).optional(),
  widthCm: z.number().min(0).optional(),
  heightCm: z.number().min(0).optional(),

  declaredValue: z.number().min(0).optional(),
  insuranceEnabled: z.boolean().default(false),

  specialHandling: z.array(z.string()).default([]),
  description: z.string().optional(),

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

  estimatedPickup: z.string().datetime().optional(),
  estimatedDelivery: z.string().datetime().optional(),
})

export const updateShipmentStatusSchema = z.object({
  status: z.enum([
    "PENDING", "QUOTE_CREATED", "BOOKED", "PAYMENT_PENDING", "PAYMENT_CONFIRMED",
    "AWAITING_PICKUP", "DRIVER_ASSIGNED", "ACCEPTED", "OUT_FOR_PICKUP",
    "PICKED_UP", "IN_TRANSIT", "ONGOING", "ARRIVED_DESTINATION",
    "ARRIVED_COUNTRY", "CUSTOMS_REVIEW", "CUSTOMS_CLEARED", "WAREHOUSE",
    "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNING",
    "RETURNED", "FAILED", "CANCELLED", "ON_HOLD",
  ]),
  notes: z.string().optional(),
  location: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
})

export const verifyOtpSchema = z.object({
  otp: z.string().min(4).max(6),
})

export const uploadProofSchema = z.object({
  imageUrl: z.string(),
  notes: z.string().optional(),
})

export const scheduleShipmentSchema = z.object({
  scheduledAt: z.string().datetime(),
  note: z.string().optional(),
})

export const createParcelShipmentSchema = z.object({
  parcelCategoryId: z.string(),
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
  actualWeightKg: z.number().min(0.01),
  description: z.string().optional(),
  payer: z.enum(["SENDER", "RECEIVER"]).default("SENDER"),
  isScheduled: z.boolean().default(false),
  scheduledAt: z.string().datetime().optional(),
  note: z.string().optional(),
  pickupNote: z.string().optional(),
  isParcelDeliveryProofEnabled: z.boolean().default(false),
  tips: z.number().min(0).optional(),
})

export const assignShipmentSchema = z.object({
  driverId: z.string(),
  vehicleId: z.string().optional(),
  notes: z.string().optional(),
})
