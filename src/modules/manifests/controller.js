import prisma from "../../prisma/client.js"
import { z } from "zod"

const createManifestSchema = z.object({
  routeId: z.string().optional(),
  driverId: z.string().optional(),
  vehicleId: z.string().optional(),
  shipmentIds: z.array(z.string()),
  departureAt: z.string().datetime().optional(),
  arrivalAt: z.string().datetime().optional(),
  notes: z.string().optional(),
})

function generateManifestNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, "0")
  return `MNF-${year}-${random}`
}

export async function listManifests(req, res, next) {
  try {
    const manifests = await prisma.manifest.findMany({
      include: {
        route: { include: { fromCity: true, toCity: true } },
        driver: { include: { user: { select: { name: true, phone: true } } } },
        vehicle: true,
        shipments: { select: { id: true, trackingNumber: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: manifests })
  } catch (err) { next(err) }
}

export async function createManifest(req, res, next) {
  try {
    const data = createManifestSchema.parse(req.body)

    const shipments = await prisma.shipment.findMany({
      where: { id: { in: data.shipmentIds } },
    })

    let totalWeight = 0
    for (const s of shipments) {
      totalWeight += Number(s.chargeableWeightKg)
    }

    const manifest = await prisma.manifest.create({
      data: {
        manifestNumber: generateManifestNumber(),
        routeId: data.routeId || null,
        driverId: data.driverId || null,
        vehicleId: data.vehicleId || null,
        createdById: req.user.id,
        departureAt: data.departureAt ? new Date(data.departureAt) : null,
        arrivalAt: data.arrivalAt ? new Date(data.arrivalAt) : null,
        totalShipments: shipments.length,
        totalWeightKg: totalWeight,
        notes: data.notes,
        status: "PENDING",
        shipments: { connect: data.shipmentIds.map((id) => ({ id })) },
      },
      include: { shipments: true },
    })

    for (const shipment of shipments) {
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { status: "IN_TRANSIT" },
      })
    }

    res.status(201).json({ success: true, data: manifest })
  } catch (err) { next(err) }
}

export async function updateManifestStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status } = req.body

    const manifest = await prisma.manifest.update({
      where: { id },
      data: { status },
    })

    if (status === "COMPLETED") {
      const shipments = await prisma.shipment.findMany({
        where: { manifests: { some: { id } } },
      })
      for (const s of shipments) {
        await prisma.shipment.update({
          where: { id: s.id },
          data: { status: "ARRIVED_DESTINATION" },
        })
      }
    }

    res.json({ success: true, data: manifest })
  } catch (err) { next(err) }
}
