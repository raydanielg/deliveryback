import prisma from "./client.js"

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email: "ezra@xerinexpress.com" },
  })

  if (existing) {
    console.log("Seed user already exists")
    return
  }

  const bcrypt = await import("bcryptjs")
  const hashedPassword = await bcrypt.hash("Password123!", 12)

  const admin = await prisma.user.create({
    data: {
      name: "Ezra Daniel",
      email: "ezra@xerinexpress.com",
      password: hashedPassword,
      role: "SUPER_ADMIN",
      phone: "+255700000000",
      isVerified: true,
    },
  })

  console.log("Admin user created:", { id: admin.id, email: admin.email })

  // Create Xerin carrier
  const carrier = await prisma.carrier.create({
    data: {
      name: "Xerin Express",
      type: "XERIN",
      email: "ops@xerinexpress.com",
      phone: "+255700000001",
      city: "Mwanza",
      country: "Tanzania",
    },
  })
  console.log("Xerin carrier created:", { id: carrier.id, name: carrier.name })

  // Create Tanzania country
  const tanzania = await prisma.country.create({
    data: {
      code: "TZ",
      name: "Tanzania",
      currency: "TZS",
    },
  })

  // Create regions
  const mwanzaRegion = await prisma.region.create({
    data: { countryId: tanzania.id, name: "Mwanza", code: "MWZ" },
  })
  const darRegion = await prisma.region.create({
    data: { countryId: tanzania.id, name: "Dar es Salaam", code: "DAR" },
  })

  // Create cities
  const mwanza = await prisma.city.create({
    data: {
      countryId: tanzania.id,
      regionId: mwanzaRegion.id,
      name: "Mwanza",
      latitude: -2.5167,
      longitude: 32.9000,
    },
  })
  const dar = await prisma.city.create({
    data: {
      countryId: tanzania.id,
      regionId: darRegion.id,
      name: "Dar es Salaam",
      latitude: -6.8161,
      longitude: 39.2804,
    },
  })

  // Create route Mwanza -> Dar
  const route = await prisma.route.create({
    data: {
      fromCityId: mwanza.id,
      toCityId: dar.id,
      distanceKm: 1140,
      estimatedHours: 16,
    },
  })
  console.log("Route created: Mwanza -> Dar es Salaam")

  // Create default pricing rule for domestic road standard
  const pricingRule = await prisma.pricingRule.create({
    data: {
      name: "Domestic Road Standard",
      code: "DOM-ROAD-STD",
      type: "ROUTE",
      category: "DOMESTIC",
      transportMode: "ROAD",
      serviceLevel: "STANDARD",
      routeId: route.id,
      baseFare: 10000,
      weightTiers: [
        { min: 0, max: 5, price: 15000 },
        { min: 5, max: 10, price: 25000 },
        { min: 10, max: 20, price: 40000 },
        { min: 20, max: 50, price: 70000 },
        { min: 50, price: 0 },
      ],
      priority: 10,
    },
  })
  console.log("Pricing rule created: Domestic Road Standard")

  // Add surcharges
  await prisma.surcharge.create({
    data: {
      name: "Fuel Surcharge",
      code: "FUEL-001",
      type: "FUEL_SURCHARGE",
      calculation: "FIXED",
      value: 5000,
      pricingRuleId: pricingRule.id,
    },
  })

  await prisma.surcharge.create({
    data: {
      name: "Handling Fee",
      code: "HANDLING-001",
      type: "HANDLING_FEE",
      calculation: "FIXED",
      value: 2000,
      pricingRuleId: pricingRule.id,
    },
  })
  console.log("Surcharges created")

  // Create distance-based pricing for local delivery
  await prisma.pricingRule.create({
    data: {
      name: "Local Distance Based",
      code: "LOCAL-DIST",
      type: "DISTANCE",
      category: "DOMESTIC",
      transportMode: "ROAD",
      serviceLevel: "STANDARD",
      baseFare: 2000,
      perKm: 500,
      priority: 5,
    },
  })
  console.log("Local distance pricing rule created")

  // ─── SGR Stations ───
  const sgrStations = [
    { name: "Dar es Salaam SGR Station", code: "SGR-DAR", city: "Dar es Salaam", region: "Dar es Salaam", latitude: -6.8161, longitude: 39.2804, capacityKg: 50000 },
    { name: "Morogoro SGR Station", code: "SGR-MOR", city: "Morogoro", region: "Morogoro", latitude: -6.8267, longitude: 37.6633, capacityKg: 30000 },
    { name: "Dodoma SGR Station", code: "SGR-DOD", city: "Dodoma", region: "Dodoma", latitude: -6.1731, longitude: 35.7416, capacityKg: 30000 },
    { name: "Tabora SGR Station", code: "SGR-TAB", city: "Tabora", region: "Tabora", latitude: -5.0167, longitude: 32.8000, capacityKg: 25000 },
    { name: "Kigoma SGR Station", code: "SGR-KIG", city: "Kigoma", region: "Kigoma", latitude: -4.8769, longitude: 29.2667, capacityKg: 20000 },
    { name: "Mwanza SGR Station", code: "SGR-MWZ", city: "Mwanza", region: "Mwanza", latitude: -2.5167, longitude: 32.9000, capacityKg: 25000 },
  ]

  for (const s of sgrStations) {
    await prisma.station.create({
      data: { ...s, type: "SGR_STATION", country: "Tanzania", phone: "+255700000000", managerName: "Station Manager" },
    })
  }
  console.log(`Created ${sgrStations.length} SGR stations`)

  // ─── Airport Cargo Stations ───
  const airports = [
    { name: "Julius Nyerere International Airport", code: "AIR-DAR", city: "Dar es Salaam", region: "Dar es Salaam", latitude: -6.8781, longitude: 39.3336, capacityKg: 100000 },
    { name: "Kilimanjaro International Airport", code: "AIR-JRO", city: "Kilimanjaro", region: "Kilimanjaro", latitude: -3.4291, longitude: 37.0745, capacityKg: 80000 },
    { name: "Abeid Amani Karume International Airport", code: "AIR-ZNZ", city: "Zanzibar", region: "Zanzibar", latitude: -6.2220, longitude: 39.2249, capacityKg: 60000 },
    { name: "Mwanza Airport", code: "AIR-MWZ", city: "Mwanza", region: "Mwanza", latitude: -2.4650, longitude: 32.9317, capacityKg: 40000 },
    { name: "Dodoma Airport", code: "AIR-DOD", city: "Dodoma", region: "Dodoma", latitude: -6.1708, longitude: 35.7494, capacityKg: 30000 },
  ]

  for (const a of airports) {
    await prisma.station.create({
      data: { ...a, type: "AIRPORT_CARGO", country: "Tanzania", phone: "+255700000000", managerName: "Cargo Manager" },
    })
  }
  console.log(`Created ${airports.length} airport cargo stations`)

  // ─── SGR (RAIL) Pricing Rules ───
  await prisma.pricingRule.create({
    data: {
      name: "SGR Standard Parcel",
      code: "SGR-RAIL-STD",
      type: "WEIGHT",
      category: "DOMESTIC",
      transportMode: "RAIL",
      serviceLevel: "STANDARD",
      baseFare: 2500,
      perKgRate: 1500,
      weightTiers: [
        { min: 0, max: 5, price: 10000 },
        { min: 5, max: 10, price: 17500 },
        { min: 10, max: 20, price: 30000 },
        { min: 20, max: 50, price: 60000 },
        { min: 50, price: 0 },
      ],
      priority: 10,
    },
  })

  await prisma.pricingRule.create({
    data: {
      name: "SGR Express Parcel",
      code: "SGR-RAIL-EXP",
      type: "WEIGHT",
      category: "DOMESTIC",
      transportMode: "RAIL",
      serviceLevel: "EXPRESS",
      baseFare: 4000,
      perKgRate: 2200,
      priority: 12,
    },
  })
  console.log("SGR pricing rules created")

  // ─── Air Cargo Pricing Rules ───
  await prisma.pricingRule.create({
    data: {
      name: "Air Cargo Standard",
      code: "AIR-STD",
      type: "WEIGHT",
      category: "DOMESTIC",
      transportMode: "AIR",
      serviceLevel: "STANDARD",
      baseFare: 15000,
      perKgRate: 8000,
      weightTiers: [
        { min: 0, max: 5, price: 55000 },
        { min: 5, max: 10, price: 95000 },
        { min: 10, max: 20, price: 175000 },
        { min: 20, max: 50, price: 400000 },
        { min: 50, price: 0 },
      ],
      priority: 10,
    },
  })

  await prisma.pricingRule.create({
    data: {
      name: "Air Cargo Priority",
      code: "AIR-PRI",
      type: "WEIGHT",
      category: "DOMESTIC",
      transportMode: "AIR",
      serviceLevel: "PRIORITY",
      baseFare: 25000,
      perKgRate: 12000,
      priority: 12,
    },
  })

  await prisma.pricingRule.create({
    data: {
      name: "Air Cargo International",
      code: "AIR-INT",
      type: "WEIGHT",
      category: "INTERNATIONAL",
      transportMode: "AIR",
      serviceLevel: "PRIORITY",
      baseFare: 50000,
      perKgRate: 18000,
      priority: 15,
    },
  })
  console.log("Air Cargo pricing rules created")

  // ─── SGR Surcharges ───
  const sgrRule = await prisma.pricingRule.findFirst({ where: { code: "SGR-RAIL-STD" } })
  if (sgrRule) {
    await prisma.surcharge.create({
      data: {
        name: "SGR Handling Fee",
        code: "SGR-HANDLING",
        type: "HANDLING_FEE",
        calculation: "FIXED",
        value: 3000,
        pricingRuleId: sgrRule.id,
      },
    })
    await prisma.surcharge.create({
      data: {
        name: "SGR Security Fee",
        code: "SGR-SECURITY",
        type: "SECURITY_FEE",
        calculation: "FIXED",
        value: 1500,
        pricingRuleId: sgrRule.id,
      },
    })
  }

  // ─── Air Cargo Surcharges ───
  const airRule = await prisma.pricingRule.findFirst({ where: { code: "AIR-STD" } })
  if (airRule) {
    await prisma.surcharge.create({
      data: {
        name: "Air Cargo Security Fee",
        code: "AIR-SECURITY",
        type: "SECURITY_FEE",
        calculation: "FIXED",
        value: 5000,
        pricingRuleId: airRule.id,
      },
    })
    await prisma.surcharge.create({
      data: {
        name: "Air Cargo Handling Fee",
        code: "AIR-HANDLING",
        type: "HANDLING_FEE",
        calculation: "FIXED",
        value: 8000,
        pricingRuleId: airRule.id,
      },
    })
  }
  console.log("Mode-specific surcharges created")

  console.log("\n--- Seed Complete ---")
  console.log("Admin: ezra@xerinexpress.com / Password123!")
  console.log("Carrier: Xerin Express")
  console.log("Countries: Tanzania")
  console.log("Cities: Mwanza, Dar es Salaam")
  console.log("Route: Mwanza -> Dar es Salaam (1140 km)")
  console.log("Pricing: Domestic Road Standard + Local Distance")
  console.log("SGR Stations: 6 (Dar, Morogoro, Dodoma, Tabora, Kigoma, Mwanza)")
  console.log("Airports: 5 (Dar, Kilimanjaro, Zanzibar, Mwanza, Dodoma)")
  console.log("SGR Pricing: Standard + Express")
  console.log("Air Cargo Pricing: Standard + Priority + International")
  console.log("Surcharges: SGR Handling/Security, Air Cargo Security/Handling")
}

main()
  .catch((e) => {
    console.error("Seed error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
