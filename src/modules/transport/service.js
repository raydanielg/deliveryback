import prisma from "../../prisma/client.js"
import { calculateVolumetricWeight, getChargeableWeight } from "../pricing/service.js"
import { recommendTransportMode } from "../booking/service.js"

// ============================================================
// TRANSPORT MARKETPLACE — SERVICE LAYER
// ============================================================
// Calculates transport requirements from shipment data,
// matches shipments to available transport capacity,
// and manages partner capacity publishing.
// ============================================================

/**
 * Calculate transport requirement from a shipment.
 * Returns the vehicle type, capacity, volume, cargo type, service level,
 * distance, duration, and pricing snapshot needed for dispatch.
 */
export async function calculateTransportRequirement(shipment) {
  const chargeableWeight = Number(shipment.chargeableWeightKg) || 0
  const volumetricWeight = calculateVolumetricWeight(
    shipment.lengthCm, shipment.widthCm, shipment.heightCm,
  )

  // Determine required vehicle type from booking recommendation engine
  const fromCity = shipment.fromAddress?.city || ""
  const toCity = shipment.toAddress?.city || ""
  const fromCountry = shipment.fromAddress?.country || "Tanzania"
  const toCountry = shipment.toAddress?.country || "Tanzania"

  const rec = recommendTransportMode({
    weightKg: chargeableWeight,
    lengthCm: shipment.lengthCm,
    widthCm: shipment.widthCm,
    heightCm: shipment.heightCm,
    originCity: fromCity,
    destinationCity: toCity,
    originCountry: fromCountry,
    destCountry: toCountry,
    cargoType: shipment.cargoType || "GENERAL",
    serviceLevel: shipment.serviceLevel || "STANDARD",
  })

  const bestRec = rec.recommendations?.[0] || {}
  const requiredVehicleType = bestRec.vehicleCategory || null
  const transportMode = bestRec.transportMode || shipment.transportMode || "ROAD"

  // Volume calculation
  let requiredVolumeM3 = null
  if (shipment.lengthCm && shipment.widthCm && shipment.heightCm) {
    requiredVolumeM3 = Number(
      ((shipment.lengthCm * shipment.widthCm * shipment.heightCm) / 1_000_000).toFixed(2)
    )
  }

  // Distance estimation (from route if available, otherwise from recommendation)
  let estimatedDistanceKm = null
  if (shipment.routeId) {
    const route = await prisma.route.findUnique({ where: { id: shipment.routeId } })
    if (route) estimatedDistanceKm = Number(route.distanceKm)
  }
  if (!estimatedDistanceKm && rec.estimatedDistanceKm) {
    estimatedDistanceKm = rec.estimatedDistanceKm
  }

  // Duration estimation (rough: 40 km/h average for road)
  let estimatedDurationMin = null
  if (estimatedDistanceKm) {
    if (transportMode === "AIR") {
      estimatedDurationMin = Math.ceil(estimatedDistanceKm / 800 * 60) + 120 // flight + handling
    } else if (transportMode === "RAIL") {
      estimatedDurationMin = Math.ceil(estimatedDistanceKm / 60 * 60)
    } else {
      estimatedDurationMin = Math.ceil(estimatedDistanceKm / 40 * 60)
    }
  }

  return {
    requiredVehicleType,
    requiredCapacityKg: chargeableWeight,
    requiredVolumeM3,
    cargoType: shipment.cargoType || "GENERAL",
    serviceLevel: shipment.serviceLevel || "STANDARD",
    transportMode,
    specialHandling: shipment.specialHandling || [],
    pickupWindow: shipment.estimatedPickup || shipment.scheduledAt || null,
    deliveryDeadline: shipment.estimatedDelivery || null,
    estimatedDistanceKm,
    estimatedDurationMin,
    fromCity,
    toCity,
    fromCountry,
    toCountry,
  }
}

/**
 * Create a TransportRequest record for a shipment.
 * Called when a shipment is ready for dispatch.
 */
export async function createTransportRequest(shipmentId, dispatchMode = "DIRECT_ASSIGNMENT", pricing = null) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { fromAddress: true, toAddress: true },
  })
  if (!shipment) throw new Error("Shipment not found")

  // Check if transport request already exists
  const existing = await prisma.transportRequest.findUnique({ where: { shipmentId } })
  if (existing) return existing

  const req = await calculateTransportRequirement(shipment)

  return prisma.transportRequest.create({
    data: {
      shipmentId,
      status: "PENDING",
      requiredVehicleType: req.requiredVehicleType,
      requiredCapacityKg: req.requiredCapacityKg,
      requiredVolumeM3: req.requiredVolumeM3,
      cargoType: req.cargoType,
      serviceLevel: req.serviceLevel,
      transportMode: req.transportMode,
      specialHandling: req.specialHandling,
      pickupWindow: req.pickupWindow,
      deliveryDeadline: req.deliveryDeadline,
      estimatedDistanceKm: req.estimatedDistanceKm,
      estimatedDurationMin: req.estimatedDurationMin,
      dispatchMode,
      offerRadiusKm: dispatchMode === "OPEN_ORDER" ? 50 : null,
      customerPrice: pricing?.customerPrice || shipment.totalAmount || null,
      providerSettlement: pricing?.providerSettlement || null,
      xerinMargin: pricing?.xerinMargin || null,
      currency: pricing?.currency || shipment.currency || "TZS",
    },
  })
}

/**
 * Match a transport request to available partner-published capacity.
 * Returns ranked list of TransportCapacity matches.
 */
export async function matchCapacityToShipment(transportRequestId) {
  const tr = await prisma.transportRequest.findUnique({
    where: { id: transportRequestId },
    include: { shipment: { include: { fromAddress: true, toAddress: true } } },
  })
  if (!tr) throw new Error("Transport request not found")

  const now = new Date()

  // Find available capacities matching route and vehicle type
  const capacities = await prisma.transportCapacity.findMany({
    where: {
      status: "AVAILABLE",
      availableFrom: { lte: now },
      availableTo: { gte: now },
      ...(tr.requiredVehicleType ? { vehicleType: tr.requiredVehicleType } : {}),
    },
    include: {
      partner: true,
      carrier: true,
      vehicle: true,
    },
  })

  // Filter and score matches
  const matches = []
  for (const cap of capacities) {
    const reasons = []
    let score = 0

    // Route match (city name, case-insensitive)
    const originMatch = cap.originCity.toLowerCase() === tr.shipment.fromAddress?.city?.toLowerCase()
    const destMatch = cap.destCity.toLowerCase() === tr.shipment.toAddress?.city?.toLowerCase()

    if (originMatch) { score += 30; reasons.push("Origin city matches") }
    if (destMatch) { score += 30; reasons.push("Destination city matches") }

    // Partial route match (same direction)
    if (!originMatch && !destMatch) {
      // Check if capacity route overlaps with shipment route
      const capRoute = `${cap.originCity}→${cap.destCity}`.toLowerCase()
      const shipRoute = `${tr.shipment.fromAddress?.city}→${tr.shipment.toAddress?.city}`.toLowerCase()
      if (capRoute !== shipRoute) continue // Skip non-matching routes
    }

    // Capacity check
    const capKg = Number(cap.capacityKg)
    const reqKg = Number(tr.requiredCapacityKg || 0)
    if (capKg >= reqKg) {
      score += 20
      reasons.push(`Capacity sufficient (${capKg}kg ≥ ${reqKg}kg)`)
    } else {
      continue // Skip if capacity insufficient
    }

    // Volume check
    if (tr.requiredVolumeM3 && cap.volumeM3) {
      if (Number(cap.volumeM3) >= Number(tr.requiredVolumeM3)) {
        score += 10
        reasons.push("Volume sufficient")
      }
    }

    // Pricing check
    if (cap.askingPrice) {
      const askingPrice = Number(cap.askingPrice)
      const customerPrice = Number(tr.customerPrice || 0)
      if (customerPrice > 0 && askingPrice <= customerPrice) {
        score += 10
        reasons.push("Price within customer budget")
      }
    }

    // Partner health bonus
    if (cap.partner?.health === "HEALTHY") {
      score += 5
      reasons.push("Partner in good standing")
    }

    matches.push({
      capacity: cap,
      score,
      reasons,
      rankLabel: score >= 80 ? "BEST_MATCH" : score >= 50 ? "GOOD_MATCH" : "AVAILABLE",
    })
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score)

  return matches
}

/**
 * Generate a unique trip number.
 */
export function generateTripNumber() {
  const date = new Date()
  const yy = String(date.getFullYear()).slice(2)
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, "0")
  return `TRIP-${yy}${mm}${dd}-${random}`
}

/**
 * Calculate settlement breakdown for a trip.
 * Customer price, provider settlement, Xerin margin.
 */
export function calculateSettlement(customerPrice, providerSettlement = null, adjustments = 0) {
  const cp = Number(customerPrice || 0)
  const ps = Number(providerSettlement || 0)
  const margin = cp - ps - Number(adjustments || 0)

  return {
    customerPrice: cp,
    providerSettlement: ps,
    xerinMargin: margin,
    adjustments: Number(adjustments || 0),
  }
}
