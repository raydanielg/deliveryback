import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 Seeding customer test data...")

  // ── 1. Create User ──
  const hashedPassword = await bcrypt.hash("TestPass123", 10)

  const user = await prisma.user.upsert({
    where: { email: "testcustomer@test.com" },
    update: {},
    create: {
      name: "Ezra Daniel",
      email: "testcustomer@test.com",
      password: hashedPassword,
      phone: "+255712345678",
      role: "CUSTOMER",
      isVerified: true,
      isActive: true,
    },
  })
  console.log("✅ User created:", user.email)

  // ── 2. Create Customer ──
  const customer = await prisma.customer.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      type: "INDIVIDUAL",
      phone: "+255712345678",
      altPhone: "+255787654321",
      address: "123 Mlimani City, Ubungo",
      city: "Dar es Salaam",
      region: "Dar es Salaam",
      country: "Tanzania",
      totalShipments: 5,
      totalSpent: 185000,
      rating: 4.8,
    },
  })
  console.log("✅ Customer created:", customer.id)

  // ── 3. Clean up old seed data (shipments first, then addresses) ──
  const oldShipments = await prisma.shipment.findMany({
    where: { createdById: user.id },
    select: { id: true },
  })
  if (oldShipments.length > 0) {
    const shipmentIds = oldShipments.map(s => s.id)
    await prisma.shipmentStatusHistory.deleteMany({ where: { shipmentId: { in: shipmentIds } } })
    await prisma.package.deleteMany({ where: { shipmentId: { in: shipmentIds } } })
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } })
  }
  await prisma.address.deleteMany({ where: { customerId: customer.id } })
  console.log("✅ Cleaned old seed data")

  // ── 4. Create Addresses ──
  const fromAddress = await prisma.address.create({
    data: {
      customerId: customer.id,
      label: "Home",
      fullName: "Ezra Daniel",
      phone: "+255712345678",
      line1: "123 Mlimani City, Ubungo",
      city: "Dar es Salaam",
      region: "Dar es Salaam",
      country: "Tanzania",
      latitude: -6.7760,
      longitude: 39.2618,
      isDefault: true,
    },
  })
  console.log("✅ From address created")

  const toAddress1 = await prisma.address.create({
    data: {
      customerId: customer.id,
      label: "Recipient - Arusha",
      fullName: "Amina Hassan",
      phone: "+255755111222",
      line1: "45 Themi Road, Themi",
      city: "Arusha",
      region: "Arusha",
      country: "Tanzania",
      latitude: -3.3869,
      longitude: 36.6830,
    },
  })

  const toAddress2 = await prisma.address.create({
    data: {
      customerId: customer.id,
      label: "Recipient - Mwanza",
      fullName: "Juma Saleh",
      phone: "+255755333444",
      line1: "78 Capri Point, Ilemela",
      city: "Mwanza",
      region: "Mwanza",
      country: "Tanzania",
      latitude: -2.5164,
      longitude: 32.9175,
    },
  })

  const toAddress3 = await prisma.address.create({
    data: {
      customerId: customer.id,
      label: "Recipient - Dodoma",
      fullName: "Grace Mushi",
      phone: "+255755555666",
      line1: "12 Makole, Dodoma",
      city: "Dodoma",
      region: "Dodoma",
      country: "Tanzania",
      latitude: -6.1731,
      longitude: 35.7416,
    },
  })
  console.log("✅ Addresses created (1 from + 3 to)")

  // ── 4. Create Orders + Shipments + Packages ──
  const shipmentsData = [
    {
      orderNumber: "ORD-2026-000001",
      trackingNumber: "XRD-2026-100001",
      toAddress: toAddress1,
      status: "DELIVERED",
      paymentStatus: "PAID",
      totalAmount: 25000,
      weight: 2.5,
      description: "Electronics - Phone accessories",
      estimatedDelivery: new Date("2026-08-15"),
      actualDelivery: new Date("2026-08-14"),
      packageType: "PARCEL",
      packageDesc: "Phone case and charger",
    },
    {
      orderNumber: "ORD-2026-000002",
      trackingNumber: "XRD-2026-100002",
      toAddress: toAddress2,
      status: "IN_TRANSIT",
      paymentStatus: "PAID",
      totalAmount: 45000,
      weight: 5.0,
      description: "Office supplies - Printer ink",
      estimatedDelivery: new Date("2026-09-10"),
      packageType: "BOX",
      packageDesc: "4 printer ink cartridges",
    },
    {
      orderNumber: "ORD-2026-000003",
      trackingNumber: "XRD-2026-100003",
      toAddress: toAddress3,
      status: "OUT_FOR_DELIVERY",
      paymentStatus: "PAID",
      totalAmount: 35000,
      weight: 3.2,
      description: "Gift items - Birthday presents",
      estimatedDelivery: new Date("2026-09-06"),
      packageType: "PARCEL",
      packageDesc: "Gift wrapped items",
    },
    {
      orderNumber: "ORD-2026-000004",
      trackingNumber: "XRD-2026-100004",
      toAddress: toAddress1,
      status: "PENDING",
      paymentStatus: "PENDING",
      totalAmount: 18000,
      weight: 1.0,
      description: "Documents - Legal papers",
      estimatedDelivery: new Date("2026-09-12"),
      packageType: "DOCUMENT",
      packageDesc: "Legal documents",
    },
    {
      orderNumber: "ORD-2026-000005",
      trackingNumber: "XRD-2026-100005",
      toAddress: toAddress2,
      status: "CANCELLED",
      paymentStatus: "PENDING",
      totalAmount: 62000,
      weight: 8.5,
      description: "Furniture parts - Table assembly",
      estimatedDelivery: new Date("2026-09-15"),
      packageType: "BOX",
      packageDesc: "Table assembly kit",
    },
  ]

  for (const sd of shipmentsData) {
    // Create Order (upsert to handle re-runs)
    const order = await prisma.order.upsert({
      where: { orderNumber: sd.orderNumber },
      update: {
        totalAmount: sd.totalAmount,
        paymentStatus: sd.paymentStatus,
        status: sd.status === "DELIVERED" ? "COMPLETED" : sd.status === "CANCELLED" ? "CANCELLED" : "PROCESSING",
      },
      create: {
        orderNumber: sd.orderNumber,
        createdById: user.id,
        customerId: customer.id,
        totalAmount: sd.totalAmount,
        currency: "TZS",
        paymentStatus: sd.paymentStatus,
        status: sd.status === "DELIVERED" ? "COMPLETED" : sd.status === "CANCELLED" ? "CANCELLED" : "PROCESSING",
      },
    })

    // Create Shipment
    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber: sd.trackingNumber,
        orderId: order.id,
        createdById: user.id,
        customerId: customer.id,
        fromAddressId: fromAddress.id,
        toAddressId: sd.toAddress.id,
        category: "DOMESTIC",
        transportMode: "ROAD",
        serviceLevel: "STANDARD",
        fulfillmentType: "DOOR_TO_DOOR",
        status: sd.status,
        paymentStatus: sd.paymentStatus,
        actualWeightKg: sd.weight,
        chargeableWeightKg: sd.weight,
        totalAmount: sd.totalAmount,
        currency: "TZS",
        description: sd.description,
        estimatedDelivery: sd.estimatedDelivery,
        actualDelivery: sd.actualDelivery,
        note: sd.description,
      },
    })

    // Create Package for each shipment
    await prisma.package.create({
      data: {
        shipmentId: shipment.id,
        barcode: `BC-${sd.trackingNumber}`,
        type: sd.packageType,
        weightKg: sd.weight,
        description: sd.packageDesc,
        status: sd.status === "DELIVERED" ? "DELIVERED" : sd.status === "CANCELLED" ? "CREATED" : "LOADED",
      },
    })

    // Create status history
    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: shipment.id,
        status: sd.status,
        notes: `Shipment ${sd.status.toLowerCase()}`,
        location: sd.toAddress.city,
      },
    })

    console.log(`✅ Shipment created: ${sd.trackingNumber} (${sd.status})`)
  }

  console.log("\n🎉 Seed completed successfully!")
  console.log("\n📋 Test Customer Credentials:")
  console.log("   Email:    testcustomer@test.com")
  console.log("   Password: TestPass123")
  console.log("   Phone:    +255712345678")
  console.log("   Role:     CUSTOMER")
  console.log("   Shipments: 5 (1 DELIVERED, 1 IN_TRANSIT, 1 OUT_FOR_DELIVERY, 1 PENDING, 1 CANCELLED)")
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
