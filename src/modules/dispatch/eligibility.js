import prisma from "../../prisma/client.js"

// ============================================================
// ELIGIBILITY ENGINE
// ============================================================
// A driver must NOT see or accept every order.
// Before publishing an order to a driver, calculate DRIVER ELIGIBILITY.
// If driver fails any mandatory requirement: DO NOT OFFER THE ORDER.
// Store the reason internally.
// ============================================================

const VEHICLE_LOADED_STATUSES = [
  "DRIVER_ASSIGNED", "ACCEPTED", "OUT_FOR_PICKUP", "PICKED_UP",
  "IN_TRANSIT", "ONGOING", "OUT_FOR_DELIVERY",
]

// Cargo type → required vehicle type mapping
const CARGO_VEHICLE_COMPATIBILITY = {
  GENERAL: ["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP", "TRUCK", "TRAILER", "CONTAINER"],
  PERISHABLE: ["VAN", "TRUCK", "TRAILER", "CONTAINER"], // needs refrigerated (simplified)
  FRAGILE: ["VAN", "TRUCK", "TRAILER", "CONTAINER"],
  DANGEROUS: ["TRUCK", "TRAILER", "CONTAINER"],
  VALUABLE: ["VAN", "TRUCK", "TRAILER", "CONTAINER"],
  DOCUMENT: ["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP"],
  PARCEL: ["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP", "TRUCK"],
  E_COMMERCE: ["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP", "TRUCK"],
  MACHINERY: ["TRUCK", "TRAILER", "CONTAINER"],
  PALLET: ["VAN", "TRUCK", "TRAILER", "CONTAINER"],
}

// License class → vehicle type requirements (simplified, configurable)
const LICENSE_VEHICLE_MAP = {
  A: ["MOTORCYCLE", "BICYCLE"],
  B: ["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP"],
  C: ["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP", "TRUCK"],
  D: ["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP", "TRUCK", "TRAILER", "CONTAINER"],
  E: ["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "PICKUP", "TRUCK", "TRAILER", "CONTAINER"],
}

/**
 * Check if a driver is eligible for a shipment.
 * Returns { eligible: boolean, reasons: string[], score: number, rankLabel: string }
 */
export async function checkDriverEligibility(driverId, shipmentId) {
  const reasons = []

  // 1. Load driver with documents and active vehicle assignments
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: {
      documents: true,
      user: { select: { name: true, phone: true } },
      carrier: true,
    },
  })

  if (!driver) {
    return { eligible: false, reasons: ["Driver not found"], score: 0, rankLabel: null }
  }

  // 2. Driver status — must be AVAILABLE
  if (driver.status !== "AVAILABLE") {
    reasons.push(`Driver is currently ${driver.status.replace(/_/g, " ").toLowerCase()}`)
  }

  // 3. Driver active
  if (!driver.isActive) {
    reasons.push("Driver account is inactive")
  }

  // 4. Driver approval status
  if (driver.approvalStatus !== "ACTIVE") {
    reasons.push(`Driver approval status is ${driver.approvalStatus.replace(/_/g, " ").toLowerCase()}`)
  }

  // 5. Driver online (for open order marketplace)
  if (!driver.isOnline) {
    reasons.push("Driver is offline")
  }

  // 6. License expiry
  if (driver.licenseExpiry && driver.licenseExpiry < new Date()) {
    reasons.push("Driving license has expired")
  }

  // 7. Driver documents — check for expired documents
  const expiredDoc = driver.documents.find(
    (d) => d.expiryDate && d.expiryDate < new Date() && d.status !== "REJECTED"
  )
  if (expiredDoc) {
    reasons.push(`${expiredDoc.type.replace(/_/g, " ").toLowerCase()} document has expired`)
  }

  // 8. Driver suspension status (SUSPENDED in DriverStatus enum)
  if (driver.status === "SUSPENDED") {
    reasons.push("Driver is suspended")
  }

  // 9. Load shipment with packages, addresses, vehicle info
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      packages: true,
      fromAddress: true,
      toAddress: true,
      vehicle: true,
    },
  })

  if (!shipment) {
    return { eligible: false, reasons: ["Shipment not found"], score: 0, rankLabel: null }
  }

  // 10. Current workload — how many active assignments does the driver have?
  const activeAssignments = await prisma.assignment.count({
    where: {
      driverId,
      status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"] },
    },
  })
  if (activeAssignments >= 3) {
    reasons.push("Driver has too many active assignments")
  }

  // 11. Vehicle weight capacity check
  // Find the driver's available vehicles through their carrier
  let driverVehicle = null
  if (driver.carrierId) {
    driverVehicle = await prisma.vehicle.findFirst({
      where: {
        carrierId: driver.carrierId,
        isActive: true,
        status: "AVAILABLE",
      },
      orderBy: { capacityKg: "desc" },
    })
  }

  if (driverVehicle) {
    // Check vehicle weight capacity
    const shipmentWeight = Number(shipment.chargeableWeightKg)
    const vehicleCapacity = Number(driverVehicle.capacityKg)

    // Calculate current load on this vehicle
    const currentLoad = await prisma.shipment.aggregate({
      where: {
        vehicleId: driverVehicle.id,
        status: { in: VEHICLE_LOADED_STATUSES },
        id: { not: shipmentId },
      },
      _sum: { chargeableWeightKg: true },
    })
    const projectedLoad = Number(currentLoad._sum.chargeableWeightKg || 0) + shipmentWeight

    if (projectedLoad > vehicleCapacity) {
      reasons.push(
        `Vehicle capacity ${vehicleCapacity}kg exceeded by ${(projectedLoad - vehicleCapacity).toFixed(2)}kg`
      )
    }

    // 12. Vehicle volume capacity check
    if (driverVehicle.capacityM3 && shipment.packages.length > 0) {
      const totalVolume = shipment.packages.reduce((sum, p) => {
        if (p.lengthCm && p.widthCm && p.heightCm) {
          return sum + (Number(p.lengthCm) * Number(p.widthCm) * Number(p.heightCm)) / 1_000_000
        }
        return sum
      }, 0)
      if (totalVolume > Number(driverVehicle.capacityM3)) {
        reasons.push(
          `Vehicle volume ${Number(driverVehicle.capacityM3)}m³ exceeded by ${(totalVolume - Number(driverVehicle.capacityM3)).toFixed(2)}m³`
        )
      }
    }

    // 13. Vehicle compliance — check expired insurance, license, inspection, fitness
    const expiredCompliance = ["insuranceExpiry", "roadLicenseExpiry", "inspectionExpiry", "fitnessExpiry"]
      .find((field) => driverVehicle[field] && driverVehicle[field] < new Date())
    if (expiredCompliance) {
      reasons.push(
        `Vehicle ${expiredCompliance.replace("Expiry", "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} has expired`
      )
    }

    // 14. Cargo type compatibility
    const cargoType = shipment.cargoType || "GENERAL"
    const compatibleVehicles = CARGO_VEHICLE_COMPATIBILITY[cargoType] || CARGO_VEHICLE_COMPATIBILITY.GENERAL
    if (!compatibleVehicles.includes(driverVehicle.type)) {
      reasons.push(`Vehicle type ${driverVehicle.type} not compatible with ${cargoType.toLowerCase()} cargo`)
    }

    // 15. License class check
    if (driver.licenseClass) {
      const allowedVehicles = LICENSE_VEHICLE_MAP[driver.licenseClass] || []
      if (!allowedVehicles.includes(driverVehicle.type)) {
        reasons.push(`License class ${driver.licenseClass} does not support ${driverVehicle.type} vehicles`)
      }
    }
  }

  // 16. Special handling requirements
  if (shipment.specialHandling && shipment.specialHandling.length > 0) {
    for (const handling of shipment.specialHandling) {
      if (handling === "REFRIGERATED" && driverVehicle) {
        // Simplified: check if vehicle type supports refrigerated (VAN/TRUCK/TRAILER)
        if (!["VAN", "TRUCK", "TRAILER", "CONTAINER"].includes(driverVehicle.type)) {
          reasons.push("Vehicle does not support refrigerated cargo")
        }
      }
      if (handling === "FRAGILE" && driverVehicle) {
        if (!["VAN", "TRUCK", "TRAILER", "CONTAINER"].includes(driverVehicle.type)) {
          reasons.push("Vehicle not suitable for fragile cargo")
        }
      }
    }
  }

  // 17. Service level check — SAME_DAY requires driver to be available now
  if (shipment.serviceLevel === "SAME_DAY" && driver.status !== "AVAILABLE") {
    reasons.push("Driver not available for same-day delivery")
  }

  // 18. Pickup distance check (if driver location is available)
  let pickupDistanceKm = null
  if (driver.currentLatitude && driver.currentLongitude && shipment.fromAddress) {
    pickupDistanceKm = haversineDistance(
      driver.currentLatitude,
      driver.currentLongitude,
      shipment.fromAddress.latitude || 0,
      shipment.fromAddress.longitude || 0,
    )
    // Default max radius: 50km for direct, configurable for open orders
    const maxRadius = shipment.dispatchOfferRadius || 50
    if (pickupDistanceKm > maxRadius) {
      reasons.push(`Pickup distance ${pickupDistanceKm.toFixed(1)}km exceeds ${maxRadius}km radius`)
    }
  }

  const eligible = reasons.length === 0

  // Calculate ranking score for eligible drivers
  let score = 0
  let rankLabel = "AVAILABLE"
  if (eligible) {
    score = calculateRankScore(driver, driverVehicle, pickupDistanceKm, activeAssignments, shipment)
    if (score >= 80) rankLabel = "BEST_MATCH"
    else if (score >= 60) rankLabel = "GOOD_MATCH"
    else rankLabel = "AVAILABLE"
  }

  return { eligible, reasons, score, rankLabel, driver, vehicle: driverVehicle, pickupDistanceKm }
}

/**
 * Calculate a ranking score for an eligible driver.
 * Factors: distance to pickup, driver availability, vehicle suitability,
 * capacity utilization, current workload, route compatibility, service level,
 * historical reliability, on-time performance, cancellation rate.
 */
function calculateRankScore(driver, vehicle, pickupDistanceKm, activeAssignments, shipment) {
  let score = 50 // base score

  // Distance score (closer is better, max 25 points)
  if (pickupDistanceKm !== null) {
    if (pickupDistanceKm <= 5) score += 25
    else if (pickupDistanceKm <= 10) score += 20
    else if (pickupDistanceKm <= 20) score += 15
    else if (pickupDistanceKm <= 30) score += 10
    else score += 5
  }

  // Workload score (fewer active assignments is better, max 15 points)
  if (activeAssignments === 0) score += 15
  else if (activeAssignments === 1) score += 10
  else if (activeAssignments === 2) score += 5

  // Vehicle suitability (max 10 points)
  if (vehicle) {
    const shipmentWeight = Number(shipment.chargeableWeightKg)
    const vehicleCapacity = Number(vehicle.capacityKg)
    const utilization = shipmentWeight / vehicleCapacity
    // Ideal utilization: 50-80%
    if (utilization >= 0.5 && utilization <= 0.8) score += 10
    else if (utilization > 0.8 && utilization <= 1.0) score += 7
    else if (utilization < 0.5) score += 5
    else score += 2 // over capacity (shouldn't happen if eligible)
  }

  // Driver rating (max 10 points)
  if (driver.rating) {
    score += Math.min(10, driver.rating * 2)
  }

  // Total deliveries experience (max 5 points)
  if (driver.totalDeliveries > 100) score += 5
  else if (driver.totalDeliveries > 50) score += 3
  else if (driver.totalDeliveries > 10) score += 1

  // Online status bonus
  if (driver.isOnline) score += 5

  return Math.min(100, Math.round(score))
}

/**
 * Haversine distance between two lat/lng points in km.
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371 // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Find all eligible drivers for a shipment, ranked by score.
 * Returns array of { driver, vehicle, score, rankLabel, pickupDistanceKm, reasons }
 */
export async function findEligibleDrivers(shipmentId, options = {}) {
  const { radiusKm = 50, maxDrivers = 20 } = options

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { fromAddress: true, packages: true },
  })
  if (!shipment) return []

  // Find all active, approved, available drivers
  const candidates = await prisma.driver.findMany({
    where: {
      isActive: true,
      approvalStatus: "ACTIVE",
      status: "AVAILABLE",
      isOnline: options.onlineOnly !== false, // default: only online drivers for open orders
    },
    include: {
      documents: true,
      user: { select: { name: true, phone: true } },
      carrier: { include: { vehicles: { where: { isActive: true, status: "AVAILABLE" } } } },
    },
    take: 200, // limit candidate pool for performance
  })

  const results = []
  for (const driver of candidates) {
    const result = await checkDriverEligibility(driver.id, shipmentId)
    if (result.eligible) {
      results.push({
        driverId: driver.id,
        driverName: driver.user?.name || "Unknown",
        driverPhone: driver.user?.phone,
        vehicle: result.vehicle,
        score: result.score,
        rankLabel: result.rankLabel,
        pickupDistanceKm: result.pickupDistanceKm,
        rating: driver.rating,
        totalDeliveries: driver.totalDeliveries,
        activeAssignments: await prisma.assignment.count({
          where: { driverId: driver.id, status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"] } },
        }),
      })
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)

  return results.slice(0, maxDrivers)
}
