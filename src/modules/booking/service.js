import prisma from "../../prisma/client.js"
import { calculateVolumetricWeight, getChargeableWeight, calculateQuote, generateMultipleQuotes } from "../pricing/service.js"
import { estimateOptions, LogisticsError } from "../logistics/service.js"

/**
 * Transport recommendation, driven by the vehicle-class catalog (weight limits, distance limits,
 * speeds, rates) and destination data in the database — Super Admin edits those, not this file.
 * Returns every eligible option cheapest-first, plus the ones ruled out and why.
 */
export async function recommendTransportMode(params) {
  const { weightKg, lengthCm, widthCm, heightCm, originCity, destinationCity, originCountry, destCountry, serviceLevel } = params

  const volumetricWeight = calculateVolumetricWeight(lengthCm, widthCm, heightCm)
  const chargeableWeight = getChargeableWeight(weightKg, volumetricWeight)
  const volumeM3 = lengthCm && widthCm && heightCm ? (lengthCm * widthCm * heightCm) / 1e6 : undefined
  const isInternational = (originCountry || "").toLowerCase() !== (destCountry || "").toLowerCase()
  const isSameCity = (originCity || "").toLowerCase() === (destinationCity || "").toLowerCase()

  const base = { recommendations: [], excluded: [], chargeableWeight, volumetricWeight, isInternational, isSameCity }
  try {
    const result = await estimateOptions({
      origin: { city: originCity, country: originCountry, airportIata: params.originAirport, latitude: params.originLatitude, longitude: params.originLongitude },
      destination: { city: destinationCity, country: destCountry, airportIata: params.destinationAirport, latitude: params.destinationLatitude, longitude: params.destinationLongitude },
      weightKg, chargeableKg: chargeableWeight, volumeM3, serviceLevel: serviceLevel || "STANDARD", ignoreBlocks: params.ignoreBlocks,
    })
    const cheapest = result.options[0]?.price
    const fastest = [...result.options].sort((x, y) => x.eta.maxHours - y.eta.maxHours)[0]
    base.recommendations = result.options.map((o, i) => ({
      transportMode: o.transportMode,
      // Fleet vehicle type for road (what dispatch matches against), class code for air/rail/sea.
      vehicleCategory: o.vehicleClass.vehicleType || o.vehicleClass.code,
      vehicleClassCode: o.vehicleClass.code,
      vehicleClassName: o.vehicleClass.name,
      vehicleClassNameSw: o.vehicleClass.nameSw,
      reason: `${o.vehicleClass.name}: ${o.distanceKm} km, ${o.eta.labelEn.toLowerCase()}${o.price === cheapest ? " — best price" : ""}${o === fastest && o.price !== cheapest ? " — fastest" : ""}`,
      distanceKm: o.distanceKm,
      estimatedDays: o.eta.labelEn,
      estimatedDaysSw: o.eta.labelSw,
      etaHours: { min: o.eta.minHours, max: o.eta.maxHours },
      multiDay: o.eta.multiDay,
      indicativePrice: o.price,
      tags: [o.price === cheapest && "BEST_PRICE", o === fastest && "FASTEST"].filter(Boolean),
      confidence: i === 0 ? "HIGH" : "MEDIUM",
    }))
    base.excluded = result.excluded
  } catch (err) {
    // Blocked / unlisted places must reach the caller of a booking; internal callers (dispatch) opt in to soft mode.
    if (!(err instanceof LogisticsError) || !params.soft) throw err
    base.error = err.message
  }
  return base
}

/**
 * Get pricing quotes for all recommended modes
 */
export async function getQuotesForRecommendations(params) {
  const { recommendations, ...quoteParams } = params
  const quotes = []

  for (const rec of recommendations) {
    try {
      const quote = await calculateQuote({
        ...quoteParams,
        transportMode: rec.transportMode,
        vehicleCategory: rec.vehicleClassCode || rec.vehicleCategory,
      })
      if (!quote.requiresCustomQuote) {
        quotes.push({
          ...rec,
          ...quote,
        })
      }
    } catch (err) {
      // Skip this mode if pricing not available
    }
  }

  return quotes.sort((a, b) => a.total - b.total)
}

/**
 * Generate booking reference based on transport mode
 */
export function generateBookingReference(transportMode) {
  const date = new Date()
  const yy = String(date.getFullYear()).slice(2)
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, "0")

  const prefixes = {
    ROAD: "XRD",
    RAIL: "XSGR",
    AIR: "XAIR",
    SEA: "XSEA",
    COURIER: "XCRG",
  }

  return `${prefixes[transportMode] || "XRD"}-${yy}${mm}${dd}-${random}`
}
