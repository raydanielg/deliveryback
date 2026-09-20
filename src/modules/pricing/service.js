import prisma from "../../prisma/client.js"
import { rateCardQuote } from "../logistics/service.js"

const VOLUMETRIC_DIVISOR = 5000

export function calculateVolumetricWeight(lengthCm, widthCm, heightCm) {
  if (!lengthCm || !widthCm || !heightCm) return 0
  return Number(((lengthCm * widthCm * heightCm) / VOLUMETRIC_DIVISOR).toFixed(2))
}

export function getChargeableWeight(actualWeightKg, volumetricWeightKg) {
  return Math.max(actualWeightKg, volumetricWeightKg || 0)
}

export function getWeightTier(weightKg, tiers) {
  if (!tiers || !Array.isArray(tiers)) return null
  for (const tier of tiers) {
    const min = tier.min ?? 0
    const max = tier.max ?? Infinity
    if (weightKg >= min && weightKg <= max) {
      return tier
    }
  }
  return null
}

// Resolves a known Route's distance from origin/destination city + country names.
// createShipment/calculateQuote only ever get free-text city/country strings from the
// address form, never a routeId, so without this every DISTANCE-type pricing rule and
// every PER_KM surcharge silently priced at distanceKm=0.
async function resolveDistanceKm(originCity, originCountry, destinationCity, destCountry) {
  if (!originCity || !destinationCity) return null

  const findCity = (cityName, countryName) =>
    prisma.city.findFirst({
      where: {
        name: { equals: cityName, mode: "insensitive" },
        ...(countryName ? { country: { name: { equals: countryName, mode: "insensitive" } } } : {}),
      },
    })

  const [fromCity, toCity] = await Promise.all([
    findCity(originCity, originCountry),
    findCity(destinationCity, destCountry),
  ])
  if (!fromCity || !toCity) return null

  // Distance is symmetric even if the Route row was only entered in one direction.
  const route = await prisma.route.findFirst({
    where: {
      isActive: true,
      OR: [
        { fromCityId: fromCity.id, toCityId: toCity.id },
        { fromCityId: toCity.id, toCityId: fromCity.id },
      ],
    },
  })

  return route ? Number(route.distanceKm) : null
}

async function findApplicableRules(params) {
  const { category, transportMode, serviceLevel, routeId, zoneId, countryId } = params

  const where = {
    isActive: true,
    effectiveFrom: { lte: new Date() },
    OR: [
      { effectiveTo: null },
      { effectiveTo: { gte: new Date() } },
    ],
  }

  if (category) where.category = category
  if (transportMode) where.transportMode = transportMode
  if (serviceLevel) where.serviceLevel = serviceLevel
  if (routeId) where.routeId = routeId
  if (zoneId) where.zoneId = zoneId
  if (countryId) where.countryId = countryId

  const rules = await prisma.pricingRule.findMany({
    where,
    include: { surcharges: { where: { isActive: true } } },
    orderBy: { priority: "desc" },
  })

  return rules
}

export async function calculateQuote(params) {
  const {
    category,
    transportMode = "ROAD",
    serviceLevel = "STANDARD",
    originCity,
    destinationCity,
    originCountry,
    destCountry,
    distanceKm: suppliedDistanceKm,
    actualWeightKg,
    lengthCm,
    widthCm,
    heightCm,
    routeId,
    zoneId,
    countryId,
    insuranceEnabled = false,
    declaredValue = 0,
    currency = "TZS",
  } = params

  let distanceKm = suppliedDistanceKm
  if (!distanceKm) {
    distanceKm = (await resolveDistanceKm(originCity, originCountry, destinationCity, destCountry)) || 0
  }

  const volumetricWeight = calculateVolumetricWeight(lengthCm, widthCm, heightCm)
  const chargeableWeight = getChargeableWeight(actualWeightKg, volumetricWeight)

  // Rate cards (vehicle classes) are the source of truth for price and journey time. Destinations
  // that are blocked or unlisted are refused here, for every caller.
  const card = await rateCardQuote({
    transportMode, serviceLevel,
    origin: { city: originCity, country: originCountry, airportIata: params.originAirport, latitude: params.originLatitude, longitude: params.originLongitude },
    destination: { city: destinationCity, country: destCountry, airportIata: params.destinationAirport, latitude: params.destinationLatitude, longitude: params.destinationLongitude },
    chargeableKg: chargeableWeight, actualWeightKg,
    volumeM3: lengthCm && widthCm && heightCm ? (lengthCm * widthCm * heightCm) / 1e6 : undefined,
    vehicleCategory: params.vehicleCategory,
    ignoreBlocks: params.ignoreBlocks,
  })
  if (card?.customQuote) {
    return { requiresCustomQuote: true, message: card.message, actualWeightKg, volumetricWeightKg: volumetricWeight, chargeableWeightKg: chargeableWeight }
  }
  if (card) {
    const o = card.option
    let insurancePremium = 0
    if (insuranceEnabled && declaredValue > 0) insurancePremium = Number((declaredValue * 0.015).toFixed(2))
    return {
      requiresCustomQuote: false,
      currency: "TZS",
      distanceKm: o.distanceKm,
      actualWeightKg,
      volumetricWeightKg: volumetricWeight,
      chargeableWeightKg: chargeableWeight,
      subtotal: o.price,
      fees: {},
      tax: 0,
      insurancePremium,
      total: Number((o.price + insurancePremium).toFixed(2)),
      etaMin: o.eta.minDays,
      etaMax: o.eta.maxDays,
      etaHours: { min: o.eta.minHours, max: o.eta.maxHours },
      etaLabel: { en: o.eta.labelEn, sw: o.eta.labelSw },
      multiDay: o.eta.multiDay,
      vehicleClass: o.vehicleClass,
      priceBreakdown: o.priceBreakdown,
      appliedRule: { id: o.vehicleClass.id, name: o.vehicleClass.name, code: o.vehicleClass.code, type: "RATE_CARD" },
    }
  }

  const rules = await findApplicableRules({
    category,
    transportMode,
    serviceLevel,
    routeId,
    zoneId,
    countryId,
  })

  if (rules.length === 0) {
    return {
      requiresCustomQuote: true,
      message: "No pricing rules found for this shipment configuration. A custom quote is required.",
      actualWeightKg,
      volumetricWeightKg: volumetricWeight,
      chargeableWeightKg: chargeableWeight,
    }
  }

  const rule = rules[0]

  let subtotal = Number(rule.baseFare)

  if (rule.type === "DISTANCE" && rule.perKm) {
    subtotal += Number(rule.perKm) * distanceKm
  } else if (rule.type === "WEIGHT" && rule.perKg) {
    subtotal += Number(rule.perKg) * chargeableWeight
  } else if (rule.type === "ROUTE" && rule.weightTiers) {
    const tier = getWeightTier(chargeableWeight, rule.weightTiers)
    if (tier) {
      subtotal = tier.price
    } else if (tier === null) {
      return {
        requiresCustomQuote: true,
        message: "Weight exceeds available tiers. A custom quote is required.",
        actualWeightKg,
        volumetricWeightKg: volumetricWeight,
        chargeableWeightKg: chargeableWeight,
      }
    }
  } else if (rule.type === "VOLUMETRIC" && rule.perM3) {
    const volumeM3 = (lengthCm * widthCm * heightCm) / 1000000
    subtotal += Number(rule.perM3) * volumeM3
  }

  if (rule.minCharge && subtotal < Number(rule.minCharge)) {
    subtotal = Number(rule.minCharge)
  }
  if (rule.maxCharge && subtotal > Number(rule.maxCharge)) {
    subtotal = Number(rule.maxCharge)
  }

  const fees = {}
  let totalFees = 0

  for (const surcharge of rule.surcharges) {
    let fee = 0
    if (surcharge.calculation === "FIXED") {
      fee = Number(surcharge.value)
    } else if (surcharge.calculation === "PERCENTAGE") {
      fee = (Number(surcharge.value) / 100) * subtotal
    } else if (surcharge.calculation === "PER_KG") {
      fee = Number(surcharge.value) * chargeableWeight
    } else if (surcharge.calculation === "PER_KM") {
      fee = Number(surcharge.value) * distanceKm
    }
    fees[surcharge.type] = Number(fee.toFixed(2))
    totalFees += fee
  }

  let insurancePremium = 0
  if (insuranceEnabled && declaredValue > 0) {
    const insuranceRate = 0.015
    insurancePremium = Number((declaredValue * insuranceRate).toFixed(2))
  }

  const tax = 0

  const total = Number((subtotal + totalFees + tax + insurancePremium).toFixed(2))

  const etaMap = {
    ROAD: { STANDARD: [2, 4], EXPRESS: [1, 2], ECONOMY: [3, 7] },
    AIR: { STANDARD: [1, 2], EXPRESS: [1, 1], PRIORITY: [1, 1] },
    SEA: { STANDARD: [14, 30], ECONOMY: [21, 45] },
    COURIER: { STANDARD: [1, 3], EXPRESS: [1, 1] },
    RAIL: { STANDARD: [3, 7] },
  }

  const eta = etaMap[transportMode]?.[serviceLevel] || [2, 5]

  return {
    requiresCustomQuote: false,
    currency: "TZS",
    distanceKm,
    actualWeightKg,
    volumetricWeightKg: volumetricWeight,
    chargeableWeightKg: chargeableWeight,
    subtotal: Number(subtotal.toFixed(2)),
    fees,
    tax,
    insurancePremium: Number(insurancePremium.toFixed(2)),
    total,
    etaMin: eta[0],
    etaMax: eta[1],
    appliedRule: {
      id: rule.id,
      name: rule.name,
      code: rule.code,
      type: rule.type,
    },
  }
}

export async function generateMultipleQuotes(params) {
  const { transportModes = ["ROAD", "AIR", "COURIER"], serviceLevels = ["STANDARD", "EXPRESS"] } = params

  const quotes = []

  for (const mode of transportModes) {
    for (const level of serviceLevels) {
      try {
        const quote = await calculateQuote({
          ...params,
          transportMode: mode,
          serviceLevel: level,
        })
        if (!quote.requiresCustomQuote) {
          quotes.push({
            transportMode: mode,
            serviceLevel: level,
            ...quote,
          })
        }
      } catch (err) {
        // Skip this combination
      }
    }
  }

  return quotes.sort((a, b) => a.total - b.total)
}
