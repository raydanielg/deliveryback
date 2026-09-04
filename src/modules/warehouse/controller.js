import prisma from "../../prisma/client.js"
import { triggerStatusNotification } from "../notification-service/controller.js"
import { receiveAtWarehouseSchema, verifyAndWeighSchema, assignShelfBinSchema, consolidateByRouteSchema, releaseShipmentSchema } from "./validation.js"

function generateBarcode() {
  return `WH-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`
}

export async function listWarehouseShipments(req, res, next) {
  try {
    const { stationId, status, search } = req.query
    const where = {}
    if (stationId) where.stationId = stationId
    if (status) where.status = status
    if (search) where.trackingNumber = { contains: search, mode: "insensitive" }

    const shipments = await prisma.shipment.findMany({
      where: {
        ...where,
        status: { in: ["WAREHOUSE", "RECEIVED_AT_STATION", "VERIFIED_WEIGHED", "CONSOLIDATED", "READY_FOR_DISPATCH", "READY_FOR_COLLECTION"] },
      },
      include: {
        station: { select: { id: true, name: true, code: true } },
        order: { select: { id: true, orderNumber: true, paymentStatus: true } },
        stationInventory: { include: { station: { select: { name: true, code: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })

    res.json({ success: true, data: shipments })
  } catch (err) { next(err) }
}

export async function receiveAtWarehouse(req, res, next) {
  try {
    const { id } = req.params
    const data = receiveAtWarehouseSchema.parse(req.body)

    const station = await prisma.station.findFirst({
      where: { id, type: { in: ["WAREHOUSE", "HUB"] }, isActive: true },
    })
    if (!station) return res.status(404).json({ success: false, message: "Warehouse not found" })

    const shipment = await prisma.shipment.findFirst({
      where: { trackingNumber: data.trackingNumber },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const existing = await prisma.stationInventory.findFirst({
      where: { stationId: id, shipmentId: shipment.id, status: "RECEIVED" },
    })
    if (existing) return res.status(400).json({ success: false, message: "Shipment already received at this warehouse" })

    const inventory = await prisma.stationInventory.create({
      data: {
        stationId: id,
        shipmentId: shipment.id,
        status: "RECEIVED",
        notes: data.notes,
      },
    })

    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { receivedAtStationId: id, stationId: id, status: "RECEIVED_AT_STATION" },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        event: "RECEIVED_AT_WAREHOUSE",
        status: "RECEIVED_AT_STATION",
        description: `Shipment received at warehouse: ${station.name}`,
        location: station.city,
      },
    })

    await triggerStatusNotification(shipment.id, "RECEIVED_AT_STATION")

    res.status(201).json({ success: true, data: inventory, message: "Shipment received at warehouse" })
  } catch (err) { next(err) }
}

export async function verifyAndWeigh(req, res, next) {
  try {
    const data = verifyAndWeighSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const updated = await prisma.shipment.update({
      where: { id: data.shipmentId },
      data: {
        actualWeightKg: data.actualWeightKg,
        chargeableWeightKg: data.actualWeightKg,
        weighedAt: new Date(),
        status: "VERIFIED_WEIGHED",
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: data.shipmentId,
        event: "VERIFIED_WEIGHED",
        status: "VERIFIED_WEIGHED",
        description: `Shipment verified and weighed: ${data.actualWeightKg} kg`,
      },
    })

    res.json({ success: true, data: updated, message: "Shipment verified and weighed" })
  } catch (err) { next(err) }
}

export async function generateLabel(req, res, next) {
  try {
    const { id } = req.params

    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const barcode = generateBarcode()
    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        labeledAt: new Date(),
        status: "VERIFIED_WEIGHED",
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: id,
        event: "LABEL_GENERATED",
        status: "VERIFIED_WEIGHED",
        description: `Label/QR generated. Barcode: ${barcode}`,
      },
    })

    res.json({ success: true, data: { ...updated, barcode, qrCode: `XRE-WH-${id.slice(-12).toUpperCase()}` }, message: "Label generated" })
  } catch (err) { next(err) }
}

export async function assignShelfBin(req, res, next) {
  try {
    const data = assignShelfBinSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const updated = await prisma.shipment.update({
      where: { id: data.shipmentId },
      data: { shelfBinLocation: data.shelfBinLocation },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: data.shipmentId,
        event: "SHELF_BIN_ASSIGNED",
        status: "VERIFIED_WEIGHED",
        description: `Assigned to shelf/bin: ${data.shelfBinLocation}`,
      },
    })

    res.json({ success: true, data: updated, message: `Shipment assigned to ${data.shelfBinLocation}` })
  } catch (err) { next(err) }
}

export async function consolidateByRoute(req, res, next) {
  try {
    const data = consolidateByRouteSchema.parse(req.body)

    const batchId = `CON-${data.routeLabel.toUpperCase()}-${Date.now().toString().slice(-6)}`

    await prisma.shipment.updateMany({
      where: { id: { in: data.shipmentIds } },
      data: {
        status: "CONSOLIDATED",
        consolidationBatchId: batchId,
      },
    })

    for (const shipmentId of data.shipmentIds) {
      await prisma.trackingEvent.create({
        data: {
          shipmentId,
          event: "CONSOLIDATED",
          status: "CONSOLIDATED",
          description: `Consolidated by route: ${data.routeLabel}. Batch: ${batchId}`,
        },
      })
    }

    res.json({ success: true, data: { batchId, count: data.shipmentIds.length }, message: `${data.shipmentIds.length} shipments consolidated for ${data.routeLabel}` })
  } catch (err) { next(err) }
}

export async function releaseShipment(req, res, next) {
  try {
    const data = releaseShipmentSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    if (shipment.otp && data.otp && shipment.otp !== data.otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" })
    }

    const updated = await prisma.shipment.update({
      where: { id: data.shipmentId },
      data: {
        status: "DELIVERED",
        actualDelivery: new Date(),
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: data.shipmentId,
        event: "RELEASED",
        status: "DELIVERED",
        description: `Shipment released to ${data.recipientName}${data.recipientIdNumber ? ` (ID: ${data.recipientIdType}: ${data.recipientIdNumber})` : ""}`,
      },
    })

    await triggerStatusNotification(data.shipmentId, "DELIVERED")

    res.json({ success: true, data: updated, message: "Shipment released to recipient" })
  } catch (err) { next(err) }
}

export async function getWarehouseStats(req, res, next) {
  try {
    const warehouses = await prisma.station.count({ where: { type: "WAREHOUSE", isActive: true } })
    const hubs = await prisma.station.count({ where: { type: "HUB", isActive: true } })
    const received = await prisma.shipment.count({ where: { status: "RECEIVED_AT_STATION" } })
    const verified = await prisma.shipment.count({ where: { status: "VERIFIED_WEIGHED" } })
    const consolidated = await prisma.shipment.count({ where: { status: "CONSOLIDATED" } })
    const readyForCollection = await prisma.shipment.count({ where: { status: "READY_FOR_COLLECTION" } })
    const totalInventory = await prisma.stationInventory.count({ where: { status: "RECEIVED" } })

    res.json({
      success: true,
      data: {
        warehouses,
        hubs,
        received,
        verified,
        consolidated,
        readyForCollection,
        totalInventory,
      },
    })
  } catch (err) { next(err) }
}
