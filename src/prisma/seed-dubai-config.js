// Seeds the Dubai<->Tanzania consolidation workflow config lists (XERIN spec §7):
// suppliers (14), delivery zones with fees, consolidation settings, and demo staff
// users for each of the new workflow roles.
import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

const SUPPLIERS = [
  "Other suppliers", "Amazon", "Noon", "Shein", "6th Street", "Brands for less",
  "Temu", "Aramex", "Zara", "TOPTEX", "PAPA AND MAMA", "H&M", "NAMSHI", "NEXT",
]

const DELIVERY_ZONES = [
  { name: "Collect at Tazara", code: "TAZARA", feeAmount: 0 },
  { name: "Uhuru Heights", code: "UHURU", feeAmount: 5000 },
  { name: "Zone A", code: "ZONE_A", feeAmount: 5000 },
  { name: "Zone B", code: "ZONE_B", feeAmount: 10000 },
  { name: "Zone C", code: "ZONE_C", feeAmount: 15000 },
]

const STAFF_USERS = [
  { name: "Ezekiel Massawe", email: "ezekiel@xerinexpress.com", role: "WAREHOUSE_MANAGER", phone: "+971501112233" },
  { name: "Conrad Mushi", email: "conrad@xerinexpress.com", role: "WAREHOUSE_MANAGER", phone: "+971504445566" },
  { name: "Neema Kileo", email: "neema@xerinexpress.com", role: "WAREHOUSE_MANAGER", phone: "+255715001122" },
  { name: "Faith Mwakalinga", email: "faith@xerinexpress.com", role: "WAREHOUSE_MANAGER", phone: "+255715334455" },
  { name: "Hashim Juma", email: "hashim@xerinexpress.com", role: "WAREHOUSE_MANAGER", phone: "+255715667788" },
  { name: "Sabrina Mdee", email: "sabrina@xerinexpress.com", role: "FINANCE", phone: "+255715990011" },
  { name: "Jacqueline Shirima", email: "jacqueline@xerinexpress.com", role: "FINANCE", phone: "+255715223344" },
]

async function main() {
  console.log("Seeding Dubai workflow config...")

  // Suppliers (§7.2)
  for (const name of SUPPLIERS) {
    await prisma.supplier.upsert({ where: { name }, update: {}, create: { name } })
  }
  console.log(`  Suppliers: ${SUPPLIERS.length}`)

  // Delivery zones with flat fees (§7.6)
  for (const zone of DELIVERY_ZONES) {
    await prisma.deliveryZone.upsert({
      where: { name: zone.name },
      update: { feeAmount: zone.feeAmount, code: zone.code },
      create: zone,
    })
  }
  console.log(`  Delivery zones: ${DELIVERY_ZONES.length}`)

  // Consolidation settings — single row (§7.7: 3 free days, TSh 2,000/day, 23KG box)
  const existing = await prisma.consolidationSettings.findFirst()
  if (!existing) {
    await prisma.consolidationSettings.create({
      data: { storageRatePerDayTzs: 2000, freeStorageDays: 3, defaultBoxTargetKg: 23 },
    })
  }
  console.log("  Consolidation settings: ok")

  // Staff users for the new workflow roles
  const password = await bcrypt.hash("StaffPass123!", 12)
  for (const u of STAFF_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role },
      create: { name: u.name, email: u.email, phone: u.phone, role: u.role, password, isVerified: true },
    })
  }
  console.log(`  Staff users: ${STAFF_USERS.length} (password: StaffPass123!)`)

  console.log("Done.")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
