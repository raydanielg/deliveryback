import prisma from "../../prisma/client.js"

// ============================================================
// SGR PRICING ENGINE
// ============================================================
// Calculates SGR pricing based on station pair, weight band,
// service type, first/last mile, handling, insurance, and
// special handling fees.
// ============================================================

export async function calculateSGRQuote({
  originStationId,
  destStationId,
  serviceType = "STATION_TO_STATION",
  actualWeightKg,
  declaredValue = 0,
  insuranceEnabled = false,
  specialHandling = [],
  packageCount = 1,
}) {
  // Find matching pricing rule
  const weight = Number(actualWeightKg)
  const pricing = await prisma.sGRPricing.findFirst({
    where: {
      originStationId,
      destStationId,
      serviceType,
      isActive: true,
      minWeightKg: { lte: weight },
      maxWeightKg: { gte: weight },
    },
    orderBy: { minWeightKg: "desc" },
  })

  let basePrice, perKgPrice, handlingFee, firstMilePrice, lastMilePrice, insuranceRate, specialHandlingFee, driverSettlementRate, xerinMarginRate

  if (pricing) {
    basePrice = Number(pricing.basePrice)
    perKgPrice = Number(pricing.perKgPrice)
    handlingFee = Number(pricing.handlingFee || 0)
    firstMilePrice = Number(pricing.firstMilePrice || 0)
    lastMilePrice = Number(pricing.lastMilePrice || 0)
    insuranceRate = Number(pricing.insuranceRate || 0)
    specialHandlingFee = Number(pricing.specialHandlingFee || 0)
    driverSettlementRate = Number(pricing.driverSettlementRate || 0)
    xerinMarginRate = Number(pricing.xerinMarginRate || 0)
  } else {
    // Fallback default pricing
    basePrice = 2500
    perKgPrice = 1500
    handlingFee = 500
    firstMilePrice = serviceType === "DOOR_TO_STATION" || serviceType === "DOOR_TO_DOOR" ? 5000 : 0
    lastMilePrice = serviceType === "STATION_TO_DOOR" || serviceType === "DOOR_TO_DOOR" ? 5000 : 0
    insuranceRate = 0.02
    specialHandlingFee = specialHandling.length > 0 ? 2000 : 0
    driverSettlementRate = 0.7
    xerinMarginRate = 0.15
  }

  // Calculate components
  const railCost = basePrice + (weight * perKgPrice)
  const firstMileCost = firstMilePrice
  const lastMileCost = lastMilePrice
  const handlingCost = handlingFee
  const specialHandlingCost = specialHandling.length * specialHandlingFee

  const insurancePremium = insuranceEnabled && declaredValue > 0
    ? Number(declaredValue) * insuranceRate
    : 0

  const subtotal = railCost + firstMileCost + lastMileCost + handlingCost + specialHandlingCost
  const tax = subtotal * 0.18
  const total = subtotal + insurancePremium + tax

  // Settlement breakdown
  const firstLastMileCost = firstMileCost + lastMileCost
  const driverSettlement = firstLastMileCost > 0
    ? firstLastMileCost * driverSettlementRate
    : 0
  const xerinMargin = (railCost + handlingCost) * xerinMarginRate
  const providerSettlement = total - driverSettlement - xerinMargin - tax - insurancePremium

  return {
    breakdown: {
      railCost: Math.round(railCost),
      firstMileCost: Math.round(firstMileCost),
      lastMileCost: Math.round(lastMileCost),
      handlingFee: Math.round(handlingCost),
      specialHandlingFee: Math.round(specialHandlingCost),
      insurancePremium: Math.round(insurancePremium),
      tax: Math.round(tax),
    },
    subtotal: Math.round(subtotal),
    total: Math.round(total),
    currency: "TZS",
    settlement: {
      driverSettlement: Math.round(driverSettlement),
      providerSettlement: Math.round(providerSettlement),
      xerinMargin: Math.round(xerinMargin),
    },
    pricingRule: pricing ? pricing.id : null,
  }
}

// Create or update SGR pricing rule
export async function createSGRPricingRule(data) {
  return prisma.sGRPricing.create({
    data: {
      originStationId: data.originStationId,
      destStationId: data.destStationId,
      serviceType: data.serviceType,
      minWeightKg: data.minWeightKg,
      maxWeightKg: data.maxWeightKg,
      basePrice: data.basePrice,
      perKgPrice: data.perKgPrice || 0,
      firstMilePrice: data.firstMilePrice,
      lastMilePrice: data.lastMilePrice,
      handlingFee: data.handlingFee,
      insuranceRate: data.insuranceRate,
      specialHandlingFee: data.specialHandlingFee,
      driverSettlementRate: data.driverSettlementRate,
      xerinMarginRate: data.xerinMarginRate,
      currency: data.currency || "TZS",
      isActive: data.isActive !== false,
    },
  })
}

export async function listSGRPricing(params = {}) {
  const where = {}
  if (params.originStationId) where.originStationId = params.originStationId
  if (params.destStationId) where.destStationId = params.destStationId
  if (params.serviceType) where.serviceType = params.serviceType
  if (params.isActive !== undefined) where.isActive = params.isActive

  return prisma.sGRPricing.findMany({
    where,
    include: {
      originStation: { select: { id: true, name: true, code: true, city: true } },
      destStation: { select: { id: true, name: true, code: true, city: true } },
    },
    orderBy: { createdAt: "desc" },
  })
}
