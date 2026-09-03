import prisma from "./client.js"

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email: "ezra@xerindelivery.com" },
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
      email: "ezra@xerindelivery.com",
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
      name: "Xerin Delivery",
      type: "XERIN",
      email: "ops@xerindelivery.com",
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

  console.log("\n--- Seed Complete ---")
  console.log("Admin: ezra@xerindelivery.com / Password123!")
  console.log("Carrier: Xerin Delivery")
  console.log("Countries: Tanzania")
  console.log("Cities: Mwanza, Dar es Salaam")
  console.log("Route: Mwanza -> Dar es Salaam (1140 km)")
  console.log("Pricing: Domestic Road Standard + Local Distance")
}

main()
  .catch((e) => {
    console.error("Seed error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
