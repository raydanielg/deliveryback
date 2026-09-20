import prisma from "../../prisma/client.js"
import { emitToShipment } from "../../realtime/socket.js"
import { triggerStatusNotification } from "../notification-service/controller.js"
import { logAction } from "../../middleware/audit-logger.js"
import { receiveDubaiSchema, updateDubaiReceivingSchema, supplierSchema, ITEM_TYPES } from "./validation.js"

// Tracking format: XRN-YYYY-MM-NNNN — auto-generated, unique, monthly-scoped (R1).
// "N-A" is impossible by construction.
async function generateTrackingNumber() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const prefix = `XRN-${yyyy}-${mm}-`
  const latest = await prisma.shipment.findFirst({
    where: { trackingNumber: { startsWith: prefix } },
    orderBy: { trackingNumber: "desc" },
    select: { trackingNumber: true },
  })
  const next = latest ? parseInt(latest.trackingNumber.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(next).padStart(4, "0")}`
}

function generateOrderNumber() {
  return `ORD-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`
}

// Module 1 — Dubai Receiving. Officer scans/registers a parcel at Dubai Office or
// Dubai Warehouse; the system issues the tracking number and prints the label.
export async function receiveDubai(req, res, next) {
  try {
    const data = receiveDubaiSchema.parse(req.body)

    if (data.supplierId) {
      const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } })
      if (!supplier) return res.status(400).json({ success: false, message: "Supplier not found" })
    }
    if (data.deliveryZoneId) {
      const zone = await prisma.deliveryZone.findUnique({ where: { id: data.deliveryZoneId } })
      if (!zone) return res.status(400).json({ success: false, message: "Delivery zone not found" })
    }

    const locationLabel = data.receivedLocation === "DUBAI_OFFICE" ? "Dubai Office" : "Dubai Warehouse"

    const fromAddress = await prisma.address.create({
      data: {
        fullName: data.customerName,
        phone: data.customerPhone,
        line1: locationLabel,
        city: "Dubai",
        country: "United Arab Emirates",
      },
    })

    const toAddress = await prisma.address.create({
      data: {
        fullName: data.customerName,
        phone: data.customerPhone,
        line1: "",
        city: "Dar es Salaam",
        country: "Tanzania",
      },
    })

    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        createdById: req.user.id,
        totalAmount: 0, // freight is entered later by the Accountant (Module 7)
        currency: "TZS",
        status: "CREATED",
        paymentStatus: "PENDING",
      },
    })

    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber: await generateTrackingNumber(),
        orderId: order.id,
        createdById: req.user.id,
        customerId: data.customerId || null,
        fromAddressId: fromAddress.id,
        toAddressId: toAddress.id,
        category: "INTERNATIONAL",
        transportMode: "AIR",
        status: "RECEIVED_DUBAI",
        paymentStatus: "PENDING",
        actualWeightKg: data.weightKg,
        chargeableWeightKg: data.weightKg,
        totalAmount: 0,
        currency: "TZS",
        description: data.itemDescription,
        itemType: data.itemType,
        piecesCount: data.piecesCount,
        piecesUnit: data.piecesUnit,
        receivedLocation: data.receivedLocation,
        supplierId: data.supplierId || null,
        supplierName: data.supplierName || null,
        deliveryOption: data.deliveryOption || null,
        deliveryZoneId: data.deliveryZoneId || null,
        qrPayload: `XRN|${Date.now()}|${Math.random().toString(36).slice(2, 10)}`,
        note: data.remarks || null,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        deliveryZone: { select: { id: true, name: true, feeAmount: true } },
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        event: "RECEIVED_DUBAI",
        status: "RECEIVED_DUBAI",
        description: `Received at ${locationLabel} — ${data.weightKg} KG, ${data.piecesCount} ${data.piecesUnit.toLowerCase()}${data.remarks ? ` — ${data.remarks}` : ""}`,
        location: "Dubai, UAE",
        createdBy: req.user.id,
      },
    })

    emitToShipment(shipment.id, "shipment:status_changed", {
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      status: "RECEIVED_DUBAI",
    })

    await triggerStatusNotification(shipment.id, "RECEIVED_DUBAI")

    await logAction({
      userId: req.user.id, action: "RECEIVE_DUBAI", entity: "Shipment", entityId: shipment.id,
      changes: { trackingNumber: shipment.trackingNumber, location: locationLabel, weightKg: data.weightKg, pieces: `${data.piecesCount} ${data.piecesUnit}`, customer: data.customerName }, req,
    })

    res.status(201).json({ success: true, data: shipment, message: `Received at ${locationLabel} — tracking ${shipment.trackingNumber}` })
  } catch (err) { next(err) }
}

// Queue of parcels received in Dubai awaiting consolidation into a box.
export async function listDubaiReceiving(req, res, next) {
  try {
    const { status, search, receivedLocation } = req.query
    const where = {
      receivedLocation: { not: null },
      ...(status ? { status } : { status: { in: ["RECEIVED_DUBAI", "AWAITING_CONSOLIDATION"] } }),
      ...(receivedLocation ? { receivedLocation } : {}),
      ...(search
        ? {
            OR: [
              { trackingNumber: { contains: search, mode: "insensitive" } },
              { fromAddress: { fullName: { contains: search, mode: "insensitive" } } },
              { fromAddress: { phone: { contains: search } } },
            ],
          }
        : {}),
    }

    const shipments = await prisma.shipment.findMany({
      where,
      include: {
        fromAddress: { select: { fullName: true, phone: true } },
        supplier: { select: { id: true, name: true } },
        boxItems: { include: { box: { select: { id: true, boxNumber: true, status: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    })

    res.json({ success: true, data: shipments })
  } catch (err) { next(err) }
}

export async function getDubaiShipment(req, res, next) {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: {
        fromAddress: true,
        toAddress: true,
        supplier: true,
        deliveryZone: true,
        boxItems: { include: { box: { include: { tripManifest: true } } } },
        trackingEvents: { orderBy: { createdAt: "desc" } },
      },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })
    res.json({ success: true, data: shipment })
  } catch (err) { next(err) }
}

// Editable only while the parcel is not yet sealed inside a box (spec Module 1 actions).
export async function updateDubaiReceiving(req, res, next) {
  try {
    const data = updateDubaiReceivingSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: { boxItems: { include: { box: true } } },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const sealedBox = shipment.boxItems.find((bi) => bi.box.status !== "PACKING")
    if (sealedBox) {
      return res.status(400).json({ success: false, message: `Cannot edit — parcel is inside box ${sealedBox.box.boxNumber} (${sealedBox.box.status})` })
    }

    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        ...(data.itemDescription !== undefined ? { description: data.itemDescription } : {}),
        ...(data.itemType !== undefined ? { itemType: data.itemType } : {}),
        ...(data.weightKg !== undefined ? { actualWeightKg: data.weightKg, chargeableWeightKg: data.weightKg } : {}),
        ...(data.piecesCount !== undefined ? { piecesCount: data.piecesCount } : {}),
        ...(data.piecesUnit !== undefined ? { piecesUnit: data.piecesUnit } : {}),
        ...(data.receivedLocation !== undefined ? { receivedLocation: data.receivedLocation } : {}),
        ...(data.supplierId !== undefined ? { supplierId: data.supplierId || null } : {}),
        ...(data.supplierName !== undefined ? { supplierName: data.supplierName || null } : {}),
        ...(data.deliveryOption !== undefined ? { deliveryOption: data.deliveryOption || null } : {}),
        ...(data.deliveryZoneId !== undefined ? { deliveryZoneId: data.deliveryZoneId || null } : {}),
        ...(data.remarks !== undefined ? { note: data.remarks || null } : {}),
        ...(data.customerName || data.customerPhone
          ? {
              fromAddress: {
                update: {
                  ...(data.customerName ? { fullName: data.customerName } : {}),
                  ...(data.customerPhone ? { phone: data.customerPhone } : {}),
                },
              },
              toAddress: {
                update: {
                  ...(data.customerName ? { fullName: data.customerName } : {}),
                  ...(data.customerPhone ? { phone: data.customerPhone } : {}),
                },
              },
            }
          : {}),
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        event: "DUBAI_RECEIVING_EDITED",
        status: shipment.status,
        description: `Dubai receiving record updated by ${req.user.name}`,
        createdBy: req.user.id,
      },
    })

    await logAction({
      userId: req.user.id, action: "UPDATE_DUBAI_RECEIVING", entity: "Shipment", entityId: shipment.id,
      changes: {
        before: { weightKg: shipment.actualWeightKg, piecesCount: shipment.piecesCount, itemType: shipment.itemType, receivedLocation: shipment.receivedLocation },
        after: data,
      }, req,
    })

    res.json({ success: true, data: updated, message: "Receiving record updated" })
  } catch (err) { next(err) }
}

// ─── Suppliers (Config list §7.2) ───

export async function listSuppliers(req, res, next) {
  try {
    const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } })
    res.json({ success: true, data: suppliers })
  } catch (err) { next(err) }
}

export async function createSupplier(req, res, next) {
  try {
    const data = supplierSchema.parse(req.body)
    const supplier = await prisma.supplier.create({ data })
    await logAction({ userId: req.user.id, action: "CREATE_SUPPLIER", entity: "Supplier", entityId: supplier.id, changes: data, req })
    res.status(201).json({ success: true, data: supplier, message: "Supplier created" })
  } catch (err) { next(err) }
}

export async function updateSupplier(req, res, next) {
  try {
    const data = supplierSchema.partial().parse(req.body)
    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data })
    await logAction({ userId: req.user.id, action: "UPDATE_SUPPLIER", entity: "Supplier", entityId: supplier.id, changes: data, req })
    res.json({ success: true, data: supplier, message: "Supplier updated" })
  } catch (err) { next(err) }
}

export async function deleteSupplier(req, res, next) {
  try {
    await prisma.supplier.delete({ where: { id: req.params.id } })
    await logAction({ userId: req.user.id, action: "DELETE_SUPPLIER", entity: "Supplier", entityId: req.params.id, req })
    res.json({ success: true, message: "Supplier deleted" })
  } catch (err) { next(err) }
}

export async function listItemTypes(req, res, next) {
  try {
    res.json({ success: true, data: ITEM_TYPES })
  } catch (err) { next(err) }
}
