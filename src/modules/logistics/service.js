import prisma from "../../prisma/client.js"

// Data-driven transport engine.
//
// Nothing about vehicles, rates, speeds or destinations is hardcoded here: weight limits, rate
// cards, speeds and handling times live in `VehicleClass`, journey/price adjustments per service
// level in `ServiceLevelConfig`, and destinations/airports in `City`/`Region`/`Airport`. Super
// Admin edits those tables; this file only does the arithmetic.

// Straight-line distance is shorter than the road/rail/air path actually travelled.
const PATH_FACTOR = { ROAD: 1.3, RAIL: 1.15, AIR: 1.0, SEA: 1.25, COURIER: 1.3 }
const num = (v) => (v == null ? 0 : Number(v))

export class LogisticsError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
    this.name = "LogisticsError"
  }
}

export function haversineKm(a, b) {
  const R = 6371
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLon = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const hasCoords = (p) => p && typeof p.latitude === "number" && typeof p.longitude === "number"

// Resolve a free-text place (what the address form sends) or an explicit airport to a known
// destination row. Blocked / inactive places are refused here so every caller gets the same rule.
export async function resolvePlace({ city, country, airportIata, latitude, longitude }, { role = "origin", ignoreBlocks = false } = {}) {
  if (airportIata) {
    const airport = await prisma.airport.findUnique({ where: { iata: airportIata.toUpperCase() } })
    if (!airport || !airport.isActive) throw new LogisticsError(`Airport ${airportIata} is not available`, 404)
    if (airport.isBlocked && !ignoreBlocks) throw new LogisticsError(airport.blockedReason || `${airport.name} is not accepting shipments right now`, 403)
    return { kind: "AIRPORT", label: `${airport.name} (${airport.iata})`, city: airport.city, country: airport.countryName, countryCode: airport.countryCode, latitude: airport.latitude, longitude: airport.longitude, airport }
  }
  if (!city) throw new LogisticsError(`${role} city is required`)

  const row = await prisma.city.findFirst({
    where: {
      name: { equals: city.trim(), mode: "insensitive" },
      ...(country ? { country: { name: { equals: country.trim(), mode: "insensitive" } } } : {}),
    },
    include: { region: true, country: true },
    orderBy: { isActive: "desc" },
  })
  if (!row) throw new LogisticsError(`"${city}" is not a listed destination — pick it from the destination list`, 404)

  if (!row.isActive) throw new LogisticsError(`${row.name} is not served`, 404)
  if (row.isBlocked && !ignoreBlocks) throw new LogisticsError(row.blockedReason || `${row.name} is not accepting shipments right now`, 403)
  if (row.region?.isBlocked && !ignoreBlocks) throw new LogisticsError(row.region.blockedReason || `${row.region.name} region is not accepting shipments right now`, 403)
  // A map pin inside the city (suburb, street) gives an exact point; otherwise the town centre is used.
  const exact = typeof latitude === "number" && typeof longitude === "number"
  return { kind: "CITY", label: row.name, city: row.name, country: row.country?.name, countryCode: row.country?.code, latitude: exact ? latitude : row.latitude, longitude: exact ? longitude : row.longitude, exact, cityRow: row }
}

async function distanceBetween(from, to, mode) {
  const sameTown = from.cityRow && to.cityRow && from.cityRow.id === to.cityRow.id
  if (sameTown && !(from.exact && to.exact)) {
    return { error: "Both places are in the same town — mark the exact pickup and drop-off on the map to get a distance" }
  }
  if (from.cityRow && to.cityRow && !sameTown && !(from.exact && to.exact)) {
    // A curated road distance beats a computed one.
    const route = await prisma.route.findFirst({
      where: { isActive: true, OR: [{ fromCityId: from.cityRow.id, toCityId: to.cityRow.id }, { fromCityId: to.cityRow.id, toCityId: from.cityRow.id }] },
    })
    if (route && (mode === "ROAD" || mode === "COURIER")) return { km: num(route.distanceKm), source: "ROUTE" }
  }
  if (hasCoords(from) && hasCoords(to)) {
    return { km: Math.max(1, Math.round(haversineKm(from, to) * (PATH_FACTOR[mode] ?? 1.3))), source: "COORDINATES" }
  }
  return { error: "Distance between these places is unknown — add coordinates for them in Destinations" }
}

// Journey time: handling + travel, stretched by overnight stops when the driving day limit is hit.
export function computeEta(vc, km, serviceFactor = 1) {
  const speed = Math.max(num(vc.avgSpeedKmh), 1)
  const maxDrive = Math.min(Math.max(num(vc.maxDriveHoursPerDay), 1), 24)
  const travel = km / speed
  const drivingDays = Math.max(1, Math.ceil(travel / maxDrive))
  const rest = (drivingDays - 1) * (24 - maxDrive)
  const base = (num(vc.handlingHours) + travel + rest) * serviceFactor
  const minHours = Math.max(1, Math.round(base * 0.9))
  const maxHours = Math.max(minHours + 1, Math.round(base * 1.25 + 2))
  const minDays = Math.max(1, Math.ceil(minHours / 24))
  const maxDays = Math.max(minDays, Math.ceil(maxHours / 24))
  const under = maxHours <= 24
  const range = (a, b, unit) => (a === b ? `${a} ${unit}` : `${a}–${b} ${unit}`)
  return {
    minHours, maxHours, minDays, maxDays, multiDay: maxHours > 24,
    labelEn: under ? `Within ${maxHours} hours` : range(minDays, maxDays, maxDays === 1 ? "day" : "days"),
    labelSw: under ? `Ndani ya masaa ${maxHours}` : range(minDays, maxDays, "siku"),
  }
}

export function priceForClass(vc, { km, chargeableKg, priceFactor = 1 }) {
  const extraKg = Math.max(0, chargeableKg - num(vc.includedKg))
  const distancePart = num(vc.perKm) * km
  const weightPart = num(vc.perKg) * extraKg
  let subtotal = num(vc.baseFare) + distancePart + weightPart
  if (vc.minCharge != null && subtotal < num(vc.minCharge)) subtotal = num(vc.minCharge)
  subtotal *= priceFactor
  return {
    subtotal: Math.round(subtotal / 100) * 100, // whole 100 TZS — nobody charges 10,437 shillings
    breakdown: { baseFare: num(vc.baseFare), distancePart: Math.round(distancePart), weightPart: Math.round(weightPart), extraKg, priceFactor },
  }
}

async function stationCities(type) {
  const rows = await prisma.station.findMany({ where: { type, isActive: true }, select: { city: true } })
  return new Set(rows.map((r) => (r.city || "").toLowerCase()).filter(Boolean))
}

const same = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase()

/**
 * Every transport option for this shipment: eligible ones priced with ETA, and the ones ruled out
 * with a plain reason (so the customer sees WHY a motorbike cannot carry a tonne).
 */
export async function estimateOptions(input) {
  const { origin, destination, weightKg, volumeM3, serviceLevel = "STANDARD", modes, ignoreBlocks = false } = input
  const onlyClassCode = input.onlyClassCode
  const chargeableKg = Math.max(num(input.chargeableKg) || num(weightKg), 0)

  const [from, to, classes, levels] = await Promise.all([
    resolvePlace(origin, { role: "origin", ignoreBlocks }),
    resolvePlace(destination, { role: "destination", ignoreBlocks }),
    // vehicleCategory from older clients is a fleet VehicleType (PICKUP, TRUCK…), newer ones send the class code.
    prisma.vehicleClass.findMany({
      where: {
        isActive: true,
        ...(modes?.length ? { mode: { in: modes } } : {}),
        ...(onlyClassCode ? { OR: [{ code: onlyClassCode }, { vehicleType: onlyClassCode }] } : {}),
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.serviceLevelConfig.findMany({ where: { isActive: true } }),
  ])

  const level = levels.find((l) => l.level === serviceLevel)
  if (!level) throw new LogisticsError(`Service level ${serviceLevel} is not offered`, 400)

  const domestic = !!from.countryCode && from.countryCode === to.countryCode
  const [sgrCities, airportCities] = await Promise.all([stationCities("SGR_STATION"), stationCities("AIRPORT_CARGO")])
  const airportCity = async (p) => {
    if (p.kind === "AIRPORT") return true
    const a = await prisma.airport.findFirst({ where: { isActive: true, city: { equals: p.city || "", mode: "insensitive" } } })
    return !!a
  }
  const [fromHasAirport, toHasAirport] = await Promise.all([airportCity(from), airportCity(to)])

  const options = []
  const excluded = []
  const out = (vc, reason) => excluded.push({ code: vc.code, name: vc.name, nameSw: vc.nameSw, mode: vc.mode, reason })

  for (const vc of classes) {
    const dist = await distanceBetween(from, to, vc.mode)
    if (dist.error) { out(vc, dist.error); continue }

    if (chargeableKg > num(vc.maxWeightKg)) { out(vc, `Carries up to ${num(vc.maxWeightKg)} kg — this shipment is ${chargeableKg} kg`); continue }
    if (chargeableKg < num(vc.minWeightKg)) { out(vc, `Used from ${num(vc.minWeightKg)} kg`); continue }
    if (vc.maxVolumeM3 != null && volumeM3 && volumeM3 > num(vc.maxVolumeM3)) { out(vc, `Holds up to ${num(vc.maxVolumeM3)} m³`); continue }
    if (vc.maxDistanceKm != null && dist.km > num(vc.maxDistanceKm)) { out(vc, `Only serves trips up to ${num(vc.maxDistanceKm)} km — this one is ${dist.km} km`); continue }

    if (vc.mode === "ROAD" || vc.mode === "COURIER") {
      if (!domestic) { out(vc, "Road transport is offered inside one country — use air freight across borders"); continue }
    } else if (vc.mode === "RAIL") {
      if (!domestic || same(from.city, to.city)) { out(vc, "SGR runs between two different Tanzanian stations"); continue }
      if (!sgrCities.has((from.city || "").toLowerCase()) || !sgrCities.has((to.city || "").toLowerCase())) { out(vc, "Both places need an SGR station"); continue }
    } else if (vc.mode === "AIR") {
      if (same(from.city, to.city) && from.countryCode === to.countryCode) { out(vc, "Origin and destination are the same city"); continue }
      if (!fromHasAirport || !toHasAirport) { out(vc, "Both places need an airport — choose an airport for air freight"); continue }
    } else if (vc.mode === "SEA") {
      if (domestic) { out(vc, "Sea freight is for international cargo"); continue }
    }

    const eta = computeEta(vc, dist.km, num(level.etaFactor))
    if (serviceLevel === "SAME_DAY" && eta.maxHours > 24) { out(vc, "Cannot arrive the same day on this distance"); continue }
    if (serviceLevel === "NEXT_DAY" && eta.maxHours > 48) { out(vc, "Cannot arrive by the next day on this distance"); continue }

    const price = priceForClass(vc, { km: dist.km, chargeableKg, priceFactor: num(level.priceFactor) })
    options.push({
      vehicleClass: { id: vc.id, code: vc.code, name: vc.name, nameSw: vc.nameSw, description: vc.description, mode: vc.mode, vehicleType: vc.vehicleType, maxWeightKg: num(vc.maxWeightKg) },
      transportMode: vc.mode,
      distanceKm: dist.km,
      distanceSource: dist.source,
      chargeableKg,
      price: price.subtotal,
      currency: "TZS",
      priceBreakdown: price.breakdown,
      eta,
    })
  }

  // Cheapest first; among equal prices the faster one.
  options.sort((a, b) => a.price - b.price || a.eta.maxHours - b.eta.maxHours)
  return { origin: { label: from.label, city: from.city, country: from.country }, destination: { label: to.label, city: to.city, country: to.country }, serviceLevel, options, excluded }
}

/**
 * Price + ETA for one booking from the rate cards. Returns null when the transport mode has no
 * rate cards at all (caller then falls back to the legacy pricing rules), otherwise either a quote
 * or a "custom quote needed" result that says why nothing fits.
 */
export async function rateCardQuote({ transportMode, serviceLevel = "STANDARD", origin, destination, chargeableKg, actualWeightKg, volumeM3, vehicleCategory, ignoreBlocks }) {
  const cards = await prisma.vehicleClass.count({ where: { mode: transportMode, isActive: true } })
  if (cards === 0) return null

  const result = await estimateOptions({ origin, destination, weightKg: actualWeightKg, chargeableKg, volumeM3, serviceLevel, modes: [transportMode], ignoreBlocks })
  const pick = (vehicleCategory && result.options.find((o) => o.vehicleClass.code === vehicleCategory || o.vehicleClass.vehicleType === vehicleCategory)) || result.options[0]
  if (!pick) {
    return { customQuote: true, message: result.excluded[0]?.reason || "No vehicle can carry this shipment on this route — a custom quote is required.", excluded: result.excluded }
  }
  return { customQuote: false, option: pick, alternatives: result.options.filter((o) => o !== pick) }
}

export async function assertPlacesBookable({ origin, destination }) {
  await resolvePlace(origin, { role: "origin" })
  await resolvePlace(destination, { role: "destination" })
}
