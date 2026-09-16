import dotenv from "dotenv"
dotenv.config()

import prisma from "./client.js"

const tzPhone = (idx) => `+25571${String(100000 + idx).slice(1)}`

const tanzaniaData = [
  { region: "Dar es Salaam", code: "DAR", cities: [{ name: "Dar es Salaam", lat: -6.8161, lon: 39.2804 }] },
  { region: "Mwanza", code: "MWZ", cities: [{ name: "Mwanza", lat: -2.5167, lon: 32.9000 }] },
  { region: "Arusha", code: "ARU", cities: [{ name: "Arusha", lat: -3.3869, lon: 36.6830 }] },
  { region: "Kilimanjaro", code: "KLM", cities: [{ name: "Moshi", lat: -3.3484, lon: 37.3434 }, { name: "Kilimanjaro", lat: -3.4291, lon: 37.0745 }] },
  { region: "Dodoma", code: "DOD", cities: [{ name: "Dodoma", lat: -6.1731, lon: 35.7416 }] },
  { region: "Morogoro", code: "MOR", cities: [{ name: "Morogoro", lat: -6.8267, lon: 37.6633 }] },
  { region: "Tanga", code: "TAN", cities: [{ name: "Tanga", lat: -5.0663, lon: 39.0982 }] },
  { region: "Mbeya", code: "MBE", cities: [{ name: "Mbeya", lat: -8.9094, lon: 33.4616 }] },
  { region: "Iringa", code: "IRI", cities: [{ name: "Iringa", lat: -7.7734, lon: 35.6955 }] },
  { region: "Shinyanga", code: "SHI", cities: [{ name: "Shinyanga", lat: -3.6639, lon: 33.4212 }] },
  { region: "Tabora", code: "TAB", cities: [{ name: "Tabora", lat: -5.0167, lon: 32.8000 }] },
  { region: "Kigoma", code: "KIG", cities: [{ name: "Kigoma", lat: -4.8769, lon: 29.2667 }] },
  { region: "Mtwara", code: "MTW", cities: [{ name: "Mtwara", lat: -10.2760, lon: 40.1833 }] },
  { region: "Lindi", code: "LIN", cities: [{ name: "Lindi", lat: -9.9961, lon: 39.7160 }] },
  { region: "Mara", code: "MAR", cities: [{ name: "Musoma", lat: -1.4939, lon: 33.8010 }] },
  { region: "Kagera", code: "KAG", cities: [{ name: "Bukoba", lat: -1.3308, lon: 31.8125 }] },
  { region: "Manyara", code: "MAN", cities: [{ name: "Babati", lat: -4.2167, lon: 35.7500 }] },
  { region: "Singida", code: "SIN", cities: [{ name: "Singida", lat: -4.8167, lon: 34.7500 }] },
  { region: "Rukwa", code: "RUK", cities: [{ name: "Sumbawanga", lat: -7.9700, lon: 31.6167 }] },
  { region: "Pwani", code: "PWA", cities: [{ name: "Kibaha", lat: -6.7667, lon: 38.9167 }, { name: "Bagamoyo", lat: -6.4333, lon: 38.9000 }] },
  { region: "Ruvuma", code: "RUV", cities: [{ name: "Songea", lat: -10.6833, lon: 35.6500 }] },
  { region: "Geita", code: "GEI", cities: [{ name: "Geita", lat: -2.8667, lon: 32.1833 }] },
  { region: "Katavi", code: "KAT", cities: [{ name: "Mpanda", lat: -6.3500, lon: 31.0667 }] },
  { region: "Njombe", code: "NJO", cities: [{ name: "Njombe", lat: -9.3500, lon: 34.7667 }] },
  { region: "Simiyu", code: "SIM", cities: [{ name: "Bariadi", lat: -2.6500, lon: 33.9833 }] },
  { region: "Songwe", code: "SON", cities: [{ name: "Mbeya", lat: -8.9094, lon: 33.4616 }] },
]

const routeLinks = [
  ["Dar es Salaam", "Mwanza"],
  ["Dar es Salaam", "Arusha"],
  ["Dar es Salaam", "Dodoma"],
  ["Dar es Salaam", "Morogoro"],
  ["Dar es Salaam", "Mbeya"],
  ["Dar es Salaam", "Tanga"],
  ["Dar es Salaam", "Iringa"],
  ["Mwanza", "Arusha"],
  ["Arusha", "Dodoma"],
  ["Dodoma", "Mbeya"],
  ["Mwanza", "Tabora"],
  ["Tanga", "Arusha"],
  ["Dar es Salaam", "Kilimanjaro"],
  ["Dar es Salaam", "Moshi"],
  ["Dar es Salaam", "Mtwara"],
]

const carrierData = [
  { name: "Xerin Express", type: "XERIN", city: "Dar es Salaam", email: "ops@xerinexpress.com", phone: "+255700000001", licenseNo: "XER-TZ-001" },
  { name: "Swift Freight Tanzania", type: "PARTNER", city: "Dar es Salaam", email: "swift@demo.xerin", phone: "+255700000101", licenseNo: "SFT-TZ-002" },
  { name: "Dar Logistics", type: "PARTNER", city: "Dar es Salaam", email: "darlogistics@demo.xerin", phone: "+255700000102", licenseNo: "DLT-TZ-003" },
  { name: "Highland Carriers", type: "THIRD_PARTY", city: "Arusha", email: "highland@demo.xerin", phone: "+255700000103", licenseNo: "HCT-TZ-004" },
  { name: "Lake Zone Transporters", type: "PARTNER", city: "Mwanza", email: "lzt@demo.xerin", phone: "+255700000104", licenseNo: "LZT-TZ-005" },
  { name: "Coastal Cargo Ltd", type: "THIRD_PARTY", city: "Tanga", email: "coastal@demo.xerin", phone: "+255700000105", licenseNo: "CCL-TZ-006" },
]

async function getTanzaniaContext() {
  let tanzania = await prisma.country.findUnique({ where: { code: "TZ" } })
  if (!tanzania) {
    tanzania = await prisma.country.create({
      data: { code: "TZ", name: "Tanzania", currency: "TZS" },
    })
  }
  return { tanzania }
}

async function seedAllRegionsCitiesAndZones(ctx) {
  const cityMap = {}

  for (const r of tanzaniaData) {
    let region = await prisma.region.findFirst({ where: { name: r.region } })
    if (!region) {
      region = await prisma.region.create({
        data: { countryId: ctx.tanzania.id, name: r.region, code: r.code },
      })
    }

    for (const c of r.cities) {
      let city = await prisma.city.findFirst({ where: { name: c.name, regionId: region.id } })
      if (!city) {
        city = await prisma.city.create({
          data: {
            countryId: ctx.tanzania.id,
            regionId: region.id,
            name: c.name,
            latitude: c.lat,
            longitude: c.lon,
          },
        })
      }
      cityMap[c.name] = city.id

      const zoneName = `${c.name} Zone`
      const existingZone = await prisma.zone.findFirst({ where: { name: zoneName } })
      if (!existingZone) {
        await prisma.zone.create({
          data: {
            countryId: ctx.tanzania.id,
            regionId: region.id,
            cityId: city.id,
            name: zoneName,
            code: `${r.code}-${c.name.toUpperCase().replace(/\s/g, "-")}`,
          },
        })
      }
    }
  }
  console.log(`Seeded regions/cities/zones for ${tanzaniaData.length} regions`)
  return cityMap
}

async function seedCarriers() {
  const carriers = []
  for (const c of carrierData) {
    const existing = await prisma.carrier.findFirst({ where: { name: c.name } })
    if (existing) {
      carriers.push(existing)
      continue
    }
    const created = await prisma.carrier.create({
      data: { ...c, country: "Tanzania" },
    })
    carriers.push(created)
  }
  console.log(`Seeded ${carriers.length} carriers`)
  return carriers
}

const routeDistanceMap = {
  "Dar es Salaam-Mwanza": 1140,
  "Dar es Salaam-Arusha": 630,
  "Dar es Salaam-Dodoma": 450,
  "Dar es Salaam-Morogoro": 190,
  "Dar es Salaam-Mbeya": 820,
  "Dar es Salaam-Tanga": 350,
  "Dar es Salaam-Iringa": 500,
  "Mwanza-Arusha": 530,
  "Arusha-Dodoma": 520,
  "Dodoma-Mbeya": 420,
  "Mwanza-Tabora": 330,
  "Tanga-Arusha": 420,
  "Dar es Salaam-Kilimanjaro": 560,
  "Dar es Salaam-Moshi": 580,
  "Dar es Salaam-Mtwara": 560,
}

async function seedRoutesAndPricing(cityMap) {
  let routeCount = 0
  let pricingCount = 0

  for (const [fromName, toName] of routeLinks) {
    const fromCityId = cityMap[fromName]
    const toCityId = cityMap[toName]
    if (!fromCityId || !toCityId) continue

    const key = `${fromName}-${toName}`
    const distanceKm = routeDistanceMap[key] || 300
    const existing = await prisma.route.findFirst({
      where: { fromCityId, toCityId },
    })

    let route
    if (!existing) {
      route = await prisma.route.create({
        data: {
          fromCityId,
          toCityId,
          distanceKm,
          estimatedHours: Math.round(distanceKm / 50),
          isActive: true,
        },
      })
      routeCount++
    } else {
      route = existing
    }

    const codes = [
      `ROAD-STD-${fromName.slice(0, 3).toUpperCase()}-${toName.slice(0, 3).toUpperCase()}`,
      `ROAD-EXP-${fromName.slice(0, 3).toUpperCase()}-${toName.slice(0, 3).toUpperCase()}`,
      `RAIL-STD-${fromName.slice(0, 3).toUpperCase()}-${toName.slice(0, 3).toUpperCase()}`,
    ]
    const rules = [
      { code: codes[0], name: `Road Standard ${fromName} - ${toName}`, type: "ROUTE", serviceLevel: "STANDARD", transportMode: "ROAD", baseFare: 10000, perKm: 500, weightTiers: [{ min: 0, max: 5, price: 15000 }, { min: 5, max: 10, price: 25000 }, { min: 10, max: 20, price: 40000 }, { min: 20, max: 50, price: 70000 }, { min: 50, price: 0 }] },
      { code: codes[1], name: `Road Express ${fromName} - ${toName}`, type: "ROUTE", serviceLevel: "EXPRESS", transportMode: "ROAD", baseFare: 15000, perKm: 800, weightTiers: [{ min: 0, max: 5, price: 25000 }, { min: 5, max: 10, price: 40000 }, { min: 10, max: 20, price: 65000 }, { min: 20, max: 50, price: 110000 }, { min: 50, price: 0 }] },
      { code: codes[2], name: `Rail Standard ${fromName} - ${toName}`, type: "ROUTE", serviceLevel: "STANDARD", transportMode: "RAIL", baseFare: 8000, perKm: 350, weightTiers: [{ min: 0, max: 5, price: 12000 }, { min: 5, max: 10, price: 18000 }, { min: 10, max: 20, price: 30000 }, { min: 20, max: 50, price: 55000 }, { min: 50, price: 0 }] },
    ]

    for (const rule of rules) {
      await prisma.pricingRule.upsert({
        where: { code: rule.code },
        update: {},
        create: {
          ...rule,
          category: "DOMESTIC",
          routeId: route.id,
          priority: 10,
        },
      })
      pricingCount++
    }
  }
  console.log(`Seeded ${routeCount} routes and ${pricingCount} pricing rules`)
}

async function seedVehicles(carriers) {
  const vehicles = []
  const vehicleTypes = ["MOTORCYCLE", "CAR", "VAN", "PICKUP", "TRUCK", "TRAILER"]
  const makes = ["Toyota", "Isuzu", "Fuso", "Scania", "Mercedes-Benz", "Tata", "Volvo", "Mitsubishi"]
  const models = ["Hilux", "Canter", "FM", "R500", "Actros", "LPT", "FMX", "L200"]

  let regIndex = 1
  for (let i = 0; i < carriers.length; i++) {
    const carrier = carriers[i]
    const count = 4 + (i % 3)
    for (let j = 0; j < count; j++) {
      const regNo = `T-${String(regIndex).padStart(3, "0")}-DMX`
      const type = vehicleTypes[(j + i) % vehicleTypes.length]
      const capacityKg = type === "MOTORCYCLE" ? 50 : type === "CAR" ? 200 : type === "VAN" ? 1000 : type === "PICKUP" ? 1500 : type === "TRUCK" ? 8000 : 25000
      const make = makes[(j + i) % makes.length]
      const model = models[(j + i) % models.length]

      const v = await prisma.vehicle.upsert({
        where: { registrationNo: regNo },
        update: {},
        create: {
          carrierId: carrier.id,
          registrationNo: regNo,
          type,
          capacityKg,
          make,
          model,
          year: 2018 + (j % 6),
          fuelType: "DIESEL",
          status: "AVAILABLE",
          insuranceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          roadLicenseExpiry: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
          isActive: true,
        },
      })
      vehicles.push(v)
      regIndex++
    }
  }
  console.log(`Seeded ${vehicles.length} vehicles`)
  return vehicles
}

async function seedDrivers(carriers) {
  const bcrypt = await import("bcryptjs")
  const demoPassword = await bcrypt.hash("DemoPass123!", 12)

  const firstNames = ["Juma", "Asha", "Musa", "Fatma", "Omari", "Halima", "Abdul", "Zainab", "Said", "Mariam", "Yusuf", "Rehema", "Idris", "Happiness", "Emmanuel", "Grace", "John", "Dorcas", "Peter", "Lilian"]
  const lastNames = ["Khamis", "Mwinyi", "Rajab", "Said", "Nassor", "Omar", "Mussa", "Hassan", "Juma", "Makwaia", "Mbogo", "Lema", "Kissanga", "Ngowi", "Mollel", "Msuya", "Shija", "Mallya", "Kisaka", "Lyimo"]

  let driverCount = 0
  for (let i = 0; i < 25; i++) {
    const email = `driver${i + 1}@demo.xerin`
    const exists = await prisma.user.findUnique({ where: { email } })
    if (exists) continue

    const name = `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`
    const carrier = carriers[i % carriers.length]
    const license = `TZ-DL-${String(i + 100).padStart(4, "0")}`

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: demoPassword,
        phone: tzPhone(i + 300),
        role: "DRIVER",
        isVerified: true,
      },
    })

    await prisma.driver.create({
      data: {
        userId: user.id,
        licenseNumber: license,
        licenseClass: "C",
        carrierId: carrier.id,
        status: "AVAILABLE",
        approvalStatus: "ACTIVE",
        isActive: true,
        currentLatitude: -6.8161 + (Math.random() - 0.5) * 0.4,
        currentLongitude: 39.2804 + (Math.random() - 0.5) * 0.4,
      },
    })
    driverCount++
  }
  console.log(`Seeded ${driverCount} drivers`)
}

async function main() {
  console.log("--- Demo extra seed started ---")
  const ctx = await getTanzaniaContext()
  const cityMap = await seedAllRegionsCitiesAndZones(ctx)
  const carriers = await seedCarriers()
  await seedRoutesAndPricing(cityMap)
  const vehicles = await seedVehicles(carriers)
  await seedDrivers(carriers)
  console.log("--- Demo extra seed complete ---")
}

main()
  .catch((e) => {
    console.error("Demo extra seed error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
