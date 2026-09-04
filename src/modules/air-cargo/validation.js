import { z } from "zod"

export const createAirCargoBookingSchema = z.object({
  category: z.enum(["DOMESTIC", "INTERNATIONAL", "SPECIAL_TRANSPORT"]).default("INTERNATIONAL"),
  serviceLevel: z.enum(["STANDARD", "EXPRESS", "SAME_DAY", "NEXT_DAY", "ECONOMY", "PRIORITY"]).default("EXPRESS"),
  airCargoServiceType: z.enum(["AIRPORT_TO_AIRPORT", "DOOR_TO_AIRPORT", "AIRPORT_TO_DOOR", "DOOR_TO_DOOR"]),
  airportOrigin: z.string().min(1),
  airportDestination: z.string().min(1),
  cargoType: z.enum(["GENERAL", "PERISHABLE", "DANGEROUS", "FRAGILE", "VALUABLE"]).default("GENERAL"),
  actualWeightKg: z.number().positive(),
  lengthCm: z.number().positive().optional(),
  widthCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  declaredValue: z.number().nonnegative().optional(),
  insuranceEnabled: z.boolean().default(false),
  packageType: z.enum(["DOCUMENT", "PARCEL", "BOX", "BAG", "PALLET", "CRATE", "CARGO", "ENVELOPE", "OTHER"]).default("CARGO"),
  description: z.string().max(1000).optional(),
  specialHandling: z.string().max(1000).optional(),
  flightNumber: z.string().optional(),
  flightDepartureAt: z.string().datetime().optional(),
  flightArrivalAt: z.string().datetime().optional(),
  // Sender info
  fromFullName: z.string().min(1),
  fromPhone: z.string().min(1),
  fromEmail: z.string().email().optional(),
  fromLine1: z.string().optional(),
  fromCity: z.string().min(1),
  fromCountry: z.string().min(1),
  // Receiver info
  toFullName: z.string().min(1),
  toPhone: z.string().min(1),
  toEmail: z.string().email().optional(),
  toLine1: z.string().optional(),
  toCity: z.string().min(1),
  toCountry: z.string().min(1),
})

export const acceptCargoSchema = z.object({
  actualWeightKg: z.number().positive(),
  notes: z.string().max(500).optional(),
})

export const createFlightDispatchSchema = z.object({
  shipmentIds: z.array(z.string()).min(1),
  flightNumber: z.string().min(1),
  flightDepartureAt: z.string().datetime(),
  flightArrivalAt: z.string().datetime(),
  notes: z.string().optional(),
})
