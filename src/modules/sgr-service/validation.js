import { z } from "zod"

export const createSGRBookingSchema = z.object({
  category: z.enum(["DOMESTIC", "INTERNATIONAL", "SPECIAL_TRANSPORT"]).default("DOMESTIC"),
  serviceLevel: z.enum(["STANDARD", "EXPRESS", "SAME_DAY", "NEXT_DAY", "ECONOMY", "PRIORITY"]).default("STANDARD"),
  sgrServiceType: z.enum(["STATION_TO_STATION", "DOOR_TO_STATION", "STATION_TO_DOOR", "DOOR_TO_DOOR"]),
  originStationId: z.string().min(1),
  destinationStationId: z.string().min(1),
  actualWeightKg: z.number().positive(),
  lengthCm: z.number().positive().optional(),
  widthCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  declaredValue: z.number().nonnegative().optional(),
  insuranceEnabled: z.boolean().default(false),
  packageType: z.enum(["DOCUMENT", "PARCEL", "BOX", "BAG", "PALLET", "CRATE", "CARGO", "ENVELOPE", "OTHER"]).default("PARCEL"),
  description: z.string().max(1000).optional(),
  specialHandling: z.array(z.string()).default([]),
  trainNumber: z.string().optional(),
  trainDepartureAt: z.string().datetime().optional(),
  trainArrivalAt: z.string().datetime().optional(),
  // Sender info
  fromFullName: z.string().min(1),
  fromPhone: z.string().min(1),
  fromEmail: z.string().email().optional(),
  fromLine1: z.string().optional(),
  fromCity: z.string().min(1),
  fromCountry: z.string().default("Tanzania"),
  // Receiver info
  toFullName: z.string().min(1),
  toPhone: z.string().min(1),
  toEmail: z.string().email().optional(),
  toLine1: z.string().optional(),
  toCity: z.string().min(1),
  toCountry: z.string().default("Tanzania"),
})

export const verifyWeighSchema = z.object({
  actualWeightKg: z.number().positive(),
  notes: z.string().max(500).optional(),
})

export const consolidateSchema = z.object({
  shipmentIds: z.array(z.string()).min(1),
  dispatchDate: z.string().datetime(),
  trainNumber: z.string().optional(),
  notes: z.string().optional(),
})

export const loadOnTrainSchema = z.object({
  manifestId: z.string().min(1),
  trainNumber: z.string().min(1),
  departedAt: z.string().datetime().optional(),
})
