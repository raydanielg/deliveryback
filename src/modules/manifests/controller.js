import prisma from "../../prisma/client.js"
import { z } from "zod"
import crypto from "crypto"

const createManifestSchema = z.object({
  routeId: z.string().optional(),
  driverId: z.string().optional(),
  vehicleId: z.string().optional(),
  shipmentIds: z.array(z.string()),
  departureAt: z.string().datetime().optional(),
  arrivalAt: z.string().datetime().optional(),
  notes: z.string().optional(),
})

const createSGRManifestSchema = z.object({
  originStation: z.string(),
  destinationStation: z.string(),
  serviceType: z.string().default("SGR Parcel Service"),
  batchNo: z.string(),
  reservedBlockSpaceKg: z.number().positive(),
  routeId: z.string().optional(),
  shipmentIds: z.array(z.string()).min(1),
  dispatchDate: z.string().datetime(),
  notes: z.string().optional(),
})

const scanParcelSchema = z.object({
  trackingNumber: z.string(),
})

const handoverSchema = z.object({
  step: z.enum(["PREPARED", "VERIFIED_STATION", "HANDED_OVER_RAIL", "RECEIVED_DESTINATION", "RECONCILED"]),
  name: z.string(),
  signature: z.string().optional(),
})

function generateManifestNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, "0")
  return `MNF-${year}-${random}`
}

function generateSGRManifestNumber(origin, destination) {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0")
  const orig = (origin || "XXX").toUpperCase().slice(0, 3)
  const dest = (destination || "XXX").toUpperCase().slice(0, 3)
  return `XRE-SGR-${orig}-${dest}-${random}`
}

function generateQRCode(manifestId, manifestNumber) {
  return `XRE-MNF-${manifestId.slice(-12).toUpperCase()}-${manifestNumber}`
}

export async function listManifests(req, res, next) {
  try {
    const { search, status, originStation } = req.query
    const where = {}
    if (status) where.status = status
    if (originStation) where.originStation = { contains: originStation, mode: "insensitive" }
    if (search) {
      where.OR = [
        { manifestNumber: { contains: search, mode: "insensitive" } },
        { batchNo: { contains: search, mode: "insensitive" } },
        { originStation: { contains: search, mode: "insensitive" } },
        { destinationStation: { contains: search, mode: "insensitive" } },
      ]
    }
    const manifests = await prisma.manifest.findMany({
      where,
      include: {
        route: { include: { fromCity: true, toCity: true } },
        driver: { include: { user: { select: { name: true, phone: true } } } },
        vehicle: true,
        shipments: { select: { id: true, trackingNumber: true, status: true, chargeableWeightKg: true } },
        handovers: { include: { completedBy: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: manifests })
  } catch (err) { next(err) }
}

export async function getManifest(req, res, next) {
  try {
    const { id } = req.params
    const manifest = await prisma.manifest.findUnique({
      where: { id },
      include: {
        route: { include: { fromCity: true, toCity: true } },
        driver: { include: { user: { select: { name: true, phone: true } } } },
        vehicle: true,
        shipments: {
          include: {
            order: { select: { senderName: true, senderPhone: true, receiverName: true, receiverPhone: true, description: true, quantity: true } },
            fromAddress: true,
            toAddress: true,
          },
        },
        handovers: { include: { completedBy: { select: { name: true } } }, orderBy: { completedAt: "asc" } },
        createdBy: { select: { name: true } },
      },
    })
    if (!manifest) {
      return res.status(404).json({ success: false, message: "Manifest not found" })
    }
    res.json({ success: true, data: manifest })
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

export async function createSGRManifest(req, res, next) {
  try {
    const data = createSGRManifestSchema.parse(req.body)

    const shipments = await prisma.shipment.findMany({
      where: { id: { in: data.shipmentIds } },
      include: { order: { select: { senderName: true, senderPhone: true, receiverName: true, receiverPhone: true, description: true, quantity: true } } },
    })

    if (shipments.length === 0) {
      return res.status(400).json({ success: false, message: "No valid shipments found" })
    }

    let totalWeight = 0
    let totalPackages = 0
    for (const s of shipments) {
      totalWeight += Number(s.chargeableWeightKg)
      totalPackages += Number(s.order?.quantity || 1)
    }

    if (totalWeight > data.reservedBlockSpaceKg) {
      return res.status(400).json({ success: false, message: `Total weight ${totalWeight} KG exceeds reserved block space ${data.reservedBlockSpaceKg} KG` })
    }

    const manifestNumber = generateSGRManifestNumber(data.originStation, data.destinationStation)
    const manifestId = crypto.randomUUID()
    const qrCode = generateQRCode(manifestId, manifestNumber)

    const manifest = await prisma.manifest.create({
      data: {
        id: manifestId,
        manifestNumber,
        routeId: data.routeId || null,
        createdById: req.user.id,
        totalShipments: shipments.length,
        totalWeightKg: totalWeight,
        notes: data.notes,
        status: "LOADING",
        batchNo: data.batchNo,
        originStation: data.originStation,
        destinationStation: data.destinationStation,
        serviceType: data.serviceType,
        reservedBlockSpaceKg: data.reservedBlockSpaceKg,
        qrCode,
        dispatchDate: new Date(data.dispatchDate),
        shipments: { connect: data.shipmentIds.map((id) => ({ id })) },
        handovers: {
          create: {
            step: "PREPARED",
            name: req.user.name,
            completedById: req.user.id,
            date: new Date(),
            time: new Date().toTimeString().slice(0, 5),
          },
        },
      },
      include: {
        shipments: { include: { order: { select: { senderName: true, senderPhone: true, receiverName: true, receiverPhone: true, description: true, quantity: true } } } },
        handovers: true,
      },
    })

    res.status(201).json({ success: true, data: manifest })
  } catch (err) { next(err) }
}

export async function scanParcelLoad(req, res, next) {
  try {
    const { id } = req.params
    const { trackingNumber } = scanParcelSchema.parse(req.body)

    const manifest = await prisma.manifest.findUnique({
      where: { id },
      include: { shipments: { select: { id: true, trackingNumber: true, status: true } } },
    })
    if (!manifest) {
      return res.status(404).json({ success: false, message: "Manifest not found" })
    }

    const shipment = manifest.shipments.find((s) => s.trackingNumber === trackingNumber)
    if (!shipment) {
      return res.status(404).json({ success: false, message: `Parcel ${trackingNumber} not in this manifest` })
    }

    if (shipment.status === "IN_TRANSIT") {
      return res.json({ success: true, message: `Parcel ${trackingNumber} already loaded`, data: { alreadyLoaded: true } })
    }

    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: "IN_TRANSIT" },
    })

    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: shipment.id,
        status: "IN_TRANSIT",
        notes: `Loaded to manifest ${manifest.manifestNumber}`,
        createdBy: req.user.id,
      },
    })

    const loadedCount = manifest.shipments.filter((s) => s.status === "IN_TRANSIT" || s.trackingNumber === trackingNumber).length
    const allLoaded = loadedCount === manifest.shipments.length

    if (allLoaded) {
      await prisma.manifest.update({
        where: { id },
        data: { status: "DEPARTED" },
      })
    }

    res.json({
      success: true,
      message: `Parcel ${trackingNumber} loaded successfully`,
      data: { loaded: loadedCount, total: manifest.shipments.length, allLoaded, manifestStatus: allLoaded ? "DEPARTED" : "LOADING" },
    })
  } catch (err) { next(err) }
}

export async function completeLoading(req, res, next) {
  try {
    const { id } = req.params

    const manifest = await prisma.manifest.findUnique({
      where: { id },
      include: { shipments: { select: { id: true, status: true } } },
    })
    if (!manifest) {
      return res.status(404).json({ success: false, message: "Manifest not found" })
    }

    const unloaded = manifest.shipments.filter((s) => s.status !== "IN_TRANSIT")
    if (unloaded.length > 0) {
      await prisma.shipment.deleteMany({
        where: { id: { in: unloaded.map((s) => s.id) } },
      })
      await prisma.manifest.update({
        where: { id },
        data: {
          totalShipments: manifest.shipments.length - unloaded.length,
          status: "DEPARTED",
        },
      })
      return res.json({
        success: true,
        message: `${unloaded.length} unscanned parcels removed from manifest. Departure manifest finalized.`,
        data: { removed: unloaded.length, remaining: manifest.shipments.length - unloaded.length },
      })
    }

    await prisma.manifest.update({
      where: { id },
      data: { status: "DEPARTED" },
    })

    res.json({ success: true, message: "All parcels loaded. Manifest departed.", data: { removed: 0, remaining: manifest.shipments.length } })
  } catch (err) { next(err) }
}

export async function signHandover(req, res, next) {
  try {
    const { id } = req.params
    const data = handoverSchema.parse(req.body)

    const manifest = await prisma.manifest.findUnique({
      where: { id },
      include: { handovers: true },
    })
    if (!manifest) {
      return res.status(404).json({ success: false, message: "Manifest not found" })
    }

    const existing = manifest.handovers.find((h) => h.step === data.step)
    if (existing) {
      return res.status(400).json({ success: false, message: `Step ${data.step} already signed by ${existing.name}` })
    }

    const handover = await prisma.manifestHandover.create({
      data: {
        manifestId: id,
        step: data.step,
        name: data.name,
        signature: data.signature || `Signed by ${data.name}`,
        completedById: req.user.id,
        date: new Date(),
        time: new Date().toTimeString().slice(0, 5),
      },
    })

    if (data.step === "RECONCILED") {
      await prisma.manifest.update({
        where: { id },
        data: { status: "COMPLETED" },
      })
    }

    res.status(201).json({ success: true, data: handover })
  } catch (err) { next(err) }
}

export async function getManifestByQR(req, res, next) {
  try {
    const { qrCode } = req.params
    const manifest = await prisma.manifest.findFirst({
      where: { qrCode },
      include: {
        route: { include: { fromCity: true, toCity: true } },
        shipments: {
          include: {
            order: { select: { senderName: true, senderPhone: true, receiverName: true, receiverPhone: true, description: true, quantity: true } },
          },
        },
        handovers: { include: { completedBy: { select: { name: true } } }, orderBy: { completedAt: "asc" } },
      },
    })
    if (!manifest) {
      return res.status(404).json({ success: false, message: "Invalid QR code" })
    }
    res.json({ success: true, data: manifest })
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
