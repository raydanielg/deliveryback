import { z } from "zod"

export const createTripSchema = z.object({
  passengerName: z.string().min(1),
  passengerPhone: z.string().optional(),
  passengerIdNumber: z.string().optional(),
  airline: z.string().min(1),
  flightNumber: z.string().min(1),
  flightDate: z.coerce.date(),
  departureAirport: z.string().min(1),
  arrivalAirport: z.string().min(1),
  notes: z.string().max(500).optional(),
})

export const pairBoxSchema = z.object({
  boxId: z.string().min(1),
})

export const updateTripStatusSchema = z.object({
  status: z.enum(["DEPARTED", "ARRIVED", "RECONCILED", "CANCELLED"]),
})
