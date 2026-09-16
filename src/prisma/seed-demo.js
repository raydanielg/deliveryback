import dotenv from "dotenv"
dotenv.config()

import prisma from "./client.js"

const tzPhone = (idx) => `+25571${String(100000 + idx).slice(1)}`

const darEsSalaamStations = [
  // SGR / Rail
  { name: "Dar es Salaam SGR (Pugu)", code: "SGR-DAR-PUGU", type: "SGR_STATION", address: "Pugu, Dar es Salaam", lat: -6.8981, lon: 39.1234, cap: 60000 },
  { name: "Dar es Salaam SGR (Tazara)", code: "SGR-DAR-TAZARA", type: "SGR_STATION", address: "Tazara, Dar es Salaam", lat: -6.8652, lon: 39.2698, cap: 45000 },
  { name: "Dar es Salaam SGR (Kurasini)", code: "SGR-DAR-KURASINI", type: "SGR_STATION", address: "Kurasini, Dar es Salaam", lat: -6.8467, lon: 39.2871, cap: 50000 },

  // Airport cargo
  { name: "Julius Nyerere International Cargo Terminal", code: "AIR-DAR-JNIA", type: "AIRPORT_CARGO", address: "Julius Nyerere International Airport, Dar es Salaam", lat: -6.8781, lon: 39.3336, cap: 120000 },

  // Main warehouses
  { name: "Xerin Hub - Kariakoo", code: "WH-DAR-KARIAKOO", type: "WAREHOUSE", address: "Kariakoo Market Area, Dar es Salaam", lat: -6.8222, lon: 39.2744, cap: 35000 },
  { name: "Xerin Warehouse - Ilala", code: "WH-DAR-ILALA", type: "WAREHOUSE", address: "Ilala, Dar es Salaam", lat: -6.8288, lon: 39.2634, cap: 40000 },
  { name: "Xerin Warehouse - Ubungo", code: "WH-DAR-UBUNGO", type: "WAREHOUSE", address: "Ubungo, Dar es Salaam", lat: -6.7947, lon: 39.2189, cap: 50000 },
  { name: "Xerin Warehouse - Temeke", code: "WH-DAR-TEMEKE", type: "WAREHOUSE", address: "Temeke, Dar es Salaam", lat: -6.8603, lon: 39.2614, cap: 45000 },
  { name: "Xerin Cold Storage - Kigamboni", code: "WH-DAR-KIGAMBONI", type: "WAREHOUSE", address: "Kigamboni, Dar es Salaam", lat: -6.8239, lon: 39.3097, cap: 30000 },
  { name: "Xerin Bonded Warehouse - Kurasini", code: "WH-DAR-KURASINI", type: "WAREHOUSE", address: "Kurasini, Dar es Salaam", lat: -6.8421, lon: 39.2912, cap: 55000 },

  // Hubs
  { name: "Xerin Hub - Kinondoni", code: "HUB-DAR-KINONDONI", type: "HUB", address: "Kinondoni, Dar es Salaam", lat: -6.7827, lon: 39.2637, cap: 25000 },
  { name: "Xerin Hub - Mbezi Beach", code: "HUB-DAR-MBEZI", type: "HUB", address: "Mbezi Beach, Dar es Salaam", lat: -6.7721, lon: 39.1714, cap: 22000 },
  { name: "Xerin Hub - Mikocheni", code: "HUB-DAR-MIKOCHENI", type: "HUB", address: "Mikocheni, Dar es Salaam", lat: -6.7614, lon: 39.2456, cap: 18000 },
  { name: "Xerin Hub - Masaki", code: "HUB-DAR-MASAKI", type: "HUB", address: "Masaki, Dar es Salaam", lat: -6.7544, lon: 39.2878, cap: 15000 },
  { name: "Xerin Hub - Sinza", code: "HUB-DAR-SINZA", type: "HUB", address: "Sinza, Dar es Salaam", lat: -6.7923, lon: 39.2321, cap: 16000 },
  { name: "Xerin Hub - Magomeni", code: "HUB-DAR-MAGOMENI", type: "HUB", address: "Magomeni, Dar es Salaam", lat: -6.7998, lon: 39.2367, cap: 17000 },
  { name: "Xerin Hub - Buguruni", code: "HUB-DAR-BUGURUNI", type: "HUB", address: "Buguruni, Dar es Salaam", lat: -6.8378, lon: 39.2512, cap: 18000 },
  { name: "Xerin Hub - Tabata", code: "HUB-DAR-TABATA", type: "HUB", address: "Tabata, Dar es Salaam", lat: -6.8089, lon: 39.2256, cap: 19000 },
  { name: "Xerin Hub - Segeregni", code: "HUB-DAR-SEGARENJI", type: "HUB", address: "Segeregni, Dar es Salaam", lat: -6.8154, lon: 39.2401, cap: 17000 },

  // Drop points
  { name: "Xerin Drop - Mwenge", code: "DP-DAR-MWENGE", type: "DROP_POINT", address: "Mwenge, Dar es Salaam", lat: -6.7747, lon: 39.2187, cap: 5000 },
  { name: "Xerin Drop - Msasani", code: "DP-DAR-MSASANI", type: "DROP_POINT", address: "Msasani, Dar es Salaam", lat: -6.7478, lon: 39.2698, cap: 4500 },
  { name: "Xerin Drop - Oyster Bay", code: "DP-DAR-OYSTER", type: "DROP_POINT", address: "Oyster Bay, Dar es Salaam", lat: -6.7412, lon: 39.2789, cap: 4000 },
  { name: "Xerin Drop - Kivukoni", code: "DP-DAR-KIVUKONI", type: "DROP_POINT", address: "Kivukoni, Dar es Salaam", lat: -6.8123, lon: 39.2945, cap: 3500 },
  { name: "Xerin Drop - Tandika", code: "DP-DAR-TANDIKA", type: "DROP_POINT", address: "Tandika, Dar es Salaam", lat: -6.8512, lon: 39.2589, cap: 4000 },
  { name: "Xerin Drop - Mabibo", code: "DP-DAR-MABIBO", type: "DROP_POINT", address: "Mabibo, Dar es Salaam", lat: -6.8034, lon: 39.2101, cap: 4500 },
  { name: "Xerin Drop - Hananasif", code: "DP-DAR-HANANASIF", type: "DROP_POINT", address: "Hananasif, Dar es Salaam", lat: -6.7890, lon: 39.2623, cap: 3000 },
  { name: "Xerin Drop - Gerezani", code: "DP-DAR-GEREZANI", type: "DROP_POINT", address: "Gerezani, Dar es Salaam", lat: -6.8312, lon: 39.2765, cap: 3500 },
  { name: "Xerin Drop - Mchikichini", code: "DP-DAR-MCHIKICHINI", type: "DROP_POINT", address: "Mchikichini, Dar es Salaam", lat: -6.8215, lon: 39.2567, cap: 3500 },
  { name: "Xerin Drop - Upanga", code: "DP-DAR-UPANGA", type: "DROP_POINT", address: "Upanga, Dar es Salaam", lat: -6.8121, lon: 39.2856, cap: 4000 },
  { name: "Xerin Drop - Chang'ombe", code: "DP-DAR-CHANGOMBE", type: "DROP_POINT", address: "Chang'ombe, Dar es Salaam", lat: -6.8390, lon: 39.2667, cap: 4500 },
  { name: "Xerin Drop - Tandale", code: "DP-DAR-TANDALE", type: "DROP_POINT", address: "Tandale, Dar es Salaam", lat: -6.7878, lon: 39.2489, cap: 4000 },
  { name: "Xerin Drop - Mburahati", code: "DP-DAR-MBURAHATI", type: "DROP_POINT", address: "Mburahati, Dar es Salaam", lat: -6.8156, lon: 39.2154, cap: 3500 },
]

async function getTanzaniaContext() {
  let tanzania = await prisma.country.findUnique({ where: { code: "TZ" } })
  if (!tanzania) {
    tanzania = await prisma.country.create({
      data: { code: "TZ", name: "Tanzania", currency: "TZS" },
    })
  }

  let darRegion = await prisma.region.findFirst({ where: { name: "Dar es Salaam" } })
  if (!darRegion) {
    darRegion = await prisma.region.create({
      data: { countryId: tanzania.id, name: "Dar es Salaam", code: "DAR" },
    })
  }

  let dar = await prisma.city.findFirst({ where: { name: "Dar es Salaam" } })
  if (!dar) {
    dar = await prisma.city.create({
      data: {
        countryId: tanzania.id,
        regionId: darRegion.id,
        name: "Dar es Salaam",
        latitude: -6.8161,
        longitude: 39.2804,
      },
    })
  }

  return { tanzania, darRegion, dar }
}

async function seedZones({ tanzania, darRegion, dar }) {
  const zones = [
    { name: "Kinondoni Zone", code: "DAR-KINONDONI" },
    { name: "Ilala Zone", code: "DAR-ILALA" },
    { name: "Temeke Zone", code: "DAR-TEMEKE" },
    { name: "Ubungo Zone", code: "DAR-UBUNGO" },
    { name: "Kigamboni Zone", code: "DAR-KIGAMBONI" },
  ]

  for (const z of zones) {
    const exists = await prisma.zone.findFirst({ where: { name: z.name } })
    if (!exists) {
      await prisma.zone.create({
        data: { countryId: tanzania.id, regionId: darRegion.id, cityId: dar.id, ...z },
      })
    }
  }
  console.log(`Seeded ${zones.length} Dar es Salaam zones`)
}

async function seedDarStations() {
  let created = 0
  let i = 1
  for (const s of darEsSalaamStations) {
    await prisma.station.upsert({
      where: { code: s.code },
      update: {},
      create: {
        name: s.name,
        code: s.code,
        type: s.type,
        city: "Dar es Salaam",
        region: "Dar es Salaam",
        country: "Tanzania",
        address: s.address,
        latitude: s.lat,
        longitude: s.lon,
        phone: tzPhone(i),
        email: `${s.code.toLowerCase()}@xerinexpress.com`,
        managerName: `${s.name.split(" ").pop()} Manager`,
        capacityKg: s.cap,
        isActive: true,
      },
    })
    created++
    i++
  }
  console.log(`Seeded/updated ${created} Dar es Salaam stations`)
}

async function seedOtherStations() {
  const otherStations = [
    { name: "Pugu SGR Station", code: "SGR-PUGU", type: "SGR_STATION", city: "Pugu", region: "Dar es Salaam", lat: -6.9050, lon: 39.1300, cap: 35000 },
    { name: "Soga SGR Station", code: "SGR-SOGA", type: "SGR_STATION", city: "Soga", region: "Coast", lat: -6.8000, lon: 38.9200, cap: 20000 },
    { name: "Ruvu SGR Station", code: "SGR-RUVU", type: "SGR_STATION", city: "Ruvu", region: "Coast", lat: -6.6100, lon: 38.5000, cap: 18000 },
    { name: "Morogoro SGR Station", code: "SGR-MOR", type: "SGR_STATION", city: "Morogoro", region: "Morogoro", lat: -6.8267, lon: 37.6633, cap: 30000 },
    { name: "Dodoma SGR Station", code: "SGR-DOD", type: "SGR_STATION", city: "Dodoma", region: "Dodoma", lat: -6.1731, lon: 35.7416, cap: 30000 },
    { name: "Tabora SGR Station", code: "SGR-TAB", type: "SGR_STATION", city: "Taboro", region: "Tabora", lat: -5.0167, lon: 32.8000, cap: 25000 },
    { name: "Kigoma SGR Station", code: "SGR-KIG", type: "SGR_STATION", city: "Kigoma", region: "Kigoma", lat: -4.8769, lon: 29.2667, cap: 20000 },
    { name: "Mwanza SGR Station", code: "SGR-MWZ", type: "SGR_STATION", city: "Mwanza", region: "Mwanza", lat: -2.5167, lon: 32.9000, cap: 25000 },
    { name: "Kilimanjaro International Airport", code: "AIR-JRO", type: "AIRPORT_CARGO", city: "Kilimanjaro", region: "Kilimanjaro", lat: -3.4291, lon: 37.0745, cap: 80000 },
    { name: "Abeid Amani Karume International Airport", code: "AIR-ZNZ", type: "AIRPORT_CARGO", city: "Zanzibar", region: "Zanzibar", lat: -6.2220, lon: 39.2249, cap: 60000 },
  ]

  let created = 0
  let i = 100
  for (const s of otherStations) {
    await prisma.station.upsert({
      where: { code: s.code },
      update: {},
      create: {
        name: s.name,
        code: s.code,
        type: s.type,
        city: s.city,
        region: s.region,
        country: "Tanzania",
        address: s.name,
        latitude: s.lat,
        longitude: s.lon,
        phone: tzPhone(i),
        email: `${s.code.toLowerCase()}@xerinexpress.com`,
        managerName: `${s.city} Station Manager`,
        capacityKg: s.cap,
        isActive: true,
      },
    })
    created++
    i++
  }
  console.log(`Seeded/updated ${created} other Tanzania stations`)
}

async function seedDemoUsers() {
  const bcrypt = await import("bcryptjs")
  const demoPassword = await bcrypt.hash("DemoPass123!", 12)

  const demoCustomers = [
    { name: "Juma Khamis", email: "juma@demo.xerin" },
    { name: "Asha Mwinyi", email: "asha@demo.xerin" },
    { name: "Musa Rajab", email: "musa@demo.xerin" },
    { name: "Fatma Said", email: "fatma@demo.xerin" },
    { name: "Omari Nassor", email: "omari@demo.xerin" },
  ]

  for (let i = 0; i < demoCustomers.length; i++) {
    const c = demoCustomers[i]
    const exists = await prisma.user.findUnique({ where: { email: c.email } })
    if (exists) continue

    const user = await prisma.user.create({
      data: {
        name: c.name,
        email: c.email,
        password: demoPassword,
        phone: tzPhone(i + 200),
        role: "CUSTOMER",
        isVerified: true,
      },
    })

    await prisma.customer.create({
      data: {
        userId: user.id,
        type: "INDIVIDUAL",
        phone: user.phone,
        city: "Dar es Salaam",
        region: "Dar es Salaam",
        country: "Tanzania",
      },
    })
  }
  console.log(`Seeded ${demoCustomers.length} demo customers`)
}

async function main() {
  console.log("--- Demo seed started ---")
  const ctx = await getTanzaniaContext()
  await seedZones(ctx)
  await seedDarStations()
  await seedOtherStations()
  await seedDemoUsers()
  console.log("--- Demo seed complete ---")
}

main()
  .catch((e) => {
    console.error("Demo seed error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
