import prisma from "../../prisma/client.js"
import { calculateVolumetricWeight, getChargeableWeight, calculateQuote, generateMultipleQuotes } from "../pricing/service.js"

/**
 * Intelligent Transport Mode Recommendation
 * Uses weight + dimensions + route + service requirement to recommend transport
 */
export function recommendTransportMode(params) {
  const { weightKg, lengthCm, widthCm, heightCm, originCity, destinationCity, originCountry, destCountry, cargoType, serviceLevel } = params

  const isInternational = originCountry.toLowerCase() !== destCountry.toLowerCase()
  const isSameCity = originCity.toLowerCase() === destinationCity.toLowerCase()
  const volumetricWeight = calculateVolumetricWeight(lengthCm, widthCm, heightCm)
  const chargeableWeight = getChargeableWeight(weightKg, volumetricWeight)

  const recommendations = []

  // INTERNATIONAL shipments
  if (isInternational) {
    // Air cargo for international
    recommendations.push({
      transportMode: "AIR",
      vehicleCategory: "AIR_CARGO",
      reason: "International shipment - Air Cargo is the fastest and most reliable option",
      estimatedDays: "1-3 days",
      confidence: "HIGH",
    })

    // Sea for very heavy international cargo
    if (chargeableWeight > 500) {
      recommendations.push({
        transportMode: "SEA",
        vehicleCategory: "CONTAINER",
        reason: "Heavy international cargo - Sea freight is more cost-effective for large shipments",
        estimatedDays: "14-30 days",
        confidence: "MEDIUM",
      })
    }

    // Road for neighboring countries
    if (isNeighboringCountry(originCountry, destCountry)) {
      recommendations.push({
        transportMode: "ROAD",
        vehicleCategory: chargeableWeight > 3000 ? "TRUCK" : chargeableWeight > 500 ? "PICKUP" : "VAN",
        reason: "Cross-border road transport available for neighboring countries",
        estimatedDays: "2-5 days",
        confidence: "MEDIUM",
      })
    }

    return { recommendations, chargeableWeight, volumetricWeight, isInternational, isSameCity }
  }

  // DOMESTIC shipments
  // 2kg or less - Boda
  if (chargeableWeight <= 2) {
    recommendations.push({
      transportMode: "ROAD",
      vehicleCategory: "MOTORCYCLE",
      reason: "Light package (≤2kg) - Boda Boda is the fastest and most economical option",
      estimatedDays: serviceLevel === "EXPRESS" || serviceLevel === "SAME_DAY" ? "Same day" : "1-2 hours",
      confidence: "HIGH",
    })
  }

  // 2-80kg - Car or Van
  if (chargeableWeight > 2 && chargeableWeight <= 80) {
    recommendations.push({
      transportMode: "ROAD",
      vehicleCategory: chargeableWeight <= 20 ? "CAR" : "VAN",
      reason: `Medium package (${chargeableWeight}kg) - ${chargeableWeight <= 20 ? "Car" : "Van/Kirikuu"} is recommended`,
      estimatedDays: serviceLevel === "EXPRESS" || serviceLevel === "SAME_DAY" ? "Same day" : "1-2 days",
      confidence: "HIGH",
    })
  }

  // 80-700kg - Pickup or Van
  if (chargeableWeight > 80 && chargeableWeight <= 700) {
    recommendations.push({
      transportMode: "ROAD",
      vehicleCategory: "PICKUP",
      reason: `Heavy cargo (${chargeableWeight}kg) - Pickup truck recommended for this weight range`,
      estimatedDays: serviceLevel === "EXPRESS" ? "Same day" : "1-3 days",
      confidence: "HIGH",
    })
  }

  // 700-5000kg - Truck
  if (chargeableWeight > 700 && chargeableWeight <= 5000) {
    recommendations.push({
      transportMode: "ROAD",
      vehicleCategory: "TRUCK",
      reason: `Commercial cargo (${chargeableWeight}kg) - Commercial truck required`,
      estimatedDays: "1-3 days",
      confidence: "HIGH",
    })
  }

  // 5000kg+ - Large Truck/Trailer
  if (chargeableWeight > 5000) {
    recommendations.push({
      transportMode: "ROAD",
      vehicleCategory: "TRAILER",
      reason: `Heavy cargo (${chargeableWeight}kg) - Large truck or trailer required`,
      estimatedDays: "2-5 days",
      confidence: "HIGH",
    })
  }

  // SGR Rail option for domestic intercity
  if (!isSameCity && isSGRAvailable(originCity, destinationCity)) {
    recommendations.push({
      transportMode: "RAIL",
      vehicleCategory: "SGR_PARCEL",
      reason: `SGR Parcel Service available from ${originCity} to ${destinationCity} - cost-effective for intercity transport`,
      estimatedDays: "1-2 days",
      confidence: "MEDIUM",
    })
  }

  // Sort by confidence (HIGH first)
  const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  recommendations.sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence])

  return { recommendations, chargeableWeight, volumetricWeight, isInternational, isSameCity }
}

function isNeighboringCountry(origin, dest) {
  const neighbors = {
    "tanzania": ["kenya", "uganda", "rwanda", "burundi", "zambia", "malawi", "mozambique", "dr congo", "congo"],
    "kenya": ["tanzania", "uganda", "ethiopia", "somalia", "south sudan"],
    "uganda": ["tanzania", "kenya", "rwanda", "south sudan", "dr congo"],
  }
  const originLower = origin.toLowerCase()
  const destLower = dest.toLowerCase()
  return neighbors[originLower]?.includes(destLower) || neighbors[destLower]?.includes(originLower) || false
}

function isSGRAvailable(originCity, destCity) {
  const sgrCities = ["dar es salaam", "morogoro", "dodoma", "makutupora"]
  const originLower = originCity.toLowerCase()
  const destLower = destCity.toLowerCase()
  return sgrCities.includes(originLower) && sgrCities.includes(destLower)
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
