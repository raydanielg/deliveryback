import prisma from "../../prisma/client.js"
import { calculateQuote, calculateVolumetricWeight, getChargeableWeight } from "../pricing/service.js"
import { partnerCreateShipmentSchema } from "./api-validation.js"
import { getOrCreateIntegrationSystemUser } from "../../middleware/partner-auth.js"
import { emitEvent, EVENTS } from "./event-bus.js"

function generateTrackingNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  return `XRD-${year}-${random}`
}
function generateOrderNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  return `ORD-${year}-${random}`
}
function generateBarcode() {
  return `PKG-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`
}

// Only ever return fields a partner is entitled to see — never internal notes, other
// customers' contact details beyond what they themselves supplied, or driver personal data.
function toPartnerShipment(shipment) {
  return {
    id: shipment.id,
    trackingNumber: shipment.trackingNumber,
    status: shipment.status,
    paymentStatus: shipment.paymentStatus,
    category: shipment.category,
    transportMode: shipment.transportMode,
    serviceLevel: shipment.serviceLevel,
    chargeableWeightKg: shipment.chargeableWeightKg,
    totalAmount: shipment.totalAmount,
    currency: shipment.currency,
    estimatedPickup: shipment.estimatedPickup,
    estimatedDelivery: shipment.estimatedDelivery,
    actualPickup: shipment.actualPickup,
    actualDelivery: shipment.actualDelivery,
    externalOrderId: shipment.externalOrderId,
    externalShipmentId: shipment.externalShipmentId,
    externalReference: shipment.externalReference,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  }
}

export async function createPartnerShipment(req, res, next) {
  try {
    const data = partnerCreateShipmentSchema.parse(req.body)
    const partner = req.partner

    // Idempotency: a partner retrying the same POST (network timeout, dropped response)
    // must never create a second shipment — return the one already on file instead.
    if (data.externalShipmentId) {
      const existing = await prisma.shipment.findUnique({
        where: { partnerId_externalShipmentId: { partnerId: partner.id, externalShipmentId: data.externalShipmentId } },
        include: { order: true },
      })
      if (existing) {
        return res.status(200).json({ success: true, data: toPartnerShipment(existing), message: "Shipment already exists for this external reference" })
      }
    }

    const quoteResult = await calculateQuote({
      category: data.category,
      transportMode: data.transportMode,
      serviceLevel: data.serviceLevel,
      originCity: data.fromAddress.city,
      destinationCity: data.toAddress.city,
      originCountry: data.fromAddress.country,
      destCountry: data.toAddress.country,
      actualWeightKg: data.actualWeightKg,
      lengthCm: data.lengthCm,
      widthCm: data.widthCm,
      heightCm: data.heightCm,
      insuranceEnabled: data.insuranceEnabled,
      declaredValue: data.declaredValue || 0,
    })

    if (quoteResult.requiresCustomQuote) {
      return res.status(400).json({ success: false, message: quoteResult.message })
    }

    const systemUserId = await getOrCreateIntegrationSystemUser()
    const volumetricWeight = calculateVolumetricWeight(data.lengthCm, data.widthCm, data.heightCm)
    const chargeableWeight = getChargeableWeight(data.actualWeightKg, volumetricWeight)

    const { shipment, order } = await prisma.$transaction(async (tx) => {
      const fromAddress = await tx.address.create({ data: data.fromAddress })
      const toAddress = await tx.address.create({ data: data.toAddress })

      const order = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          createdById: systemUserId,
          totalAmount: quoteResult.total,
          currency: "TZS",
          status: "CREATED",
          paymentStatus: "PENDING",
          partnerId: partner.id,
          externalOrderId: data.externalOrderId || null,
          externalReference: data.externalReference || null,
        },
      })

      const shipment = await tx.shipment.create({
        data: {
          trackingNumber: generateTrackingNumber(),
          orderId: order.id,
          createdById: systemUserId,
          fromAddressId: fromAddress.id,
          toAddressId: toAddress.id,
          category: data.category,
          shipmentType: data.shipmentType || null,
          transportMode: data.transportMode,
          serviceLevel: data.serviceLevel,
          fulfillmentType: data.fulfillmentType,
          status: "BOOKED",
          paymentStatus: "PENDING",
          actualWeightKg: data.actualWeightKg,
          volumetricWeightKg: volumetricWeight || null,
          chargeableWeightKg: chargeableWeight,
          declaredValue: data.declaredValue || null,
          insuranceEnabled: data.insuranceEnabled,
          insurancePremium: quoteResult.insurancePremium || null,
          totalAmount: quoteResult.total,
          currency: "TZS",
          specialHandling: data.specialHandling,
          description: data.description || null,
          estimatedPickup: data.estimatedPickup ? new Date(data.estimatedPickup) : null,
          estimatedDelivery: data.estimatedDelivery ? new Date(data.estimatedDelivery) : null,
          partnerId: partner.id,
          externalShipmentId: data.externalShipmentId || null,
          externalReference: data.externalReference || null,
        },
      })

      if (data.packages?.length) {
        for (const pkg of data.packages) {
          await tx.package.create({
            data: {
              shipmentId: shipment.id, barcode: generateBarcode(), type: pkg.type, weightKg: pkg.weightKg,
              lengthCm: pkg.lengthCm || null, widthCm: pkg.widthCm || null, heightCm: pkg.heightCm || null,
              declaredValue: pkg.declaredValue || null, description: pkg.description || null, isFragile: pkg.isFragile,
            },
          })
        }
      }

      await tx.shipmentStatusHistory.create({ data: { shipmentId: shipment.id, status: "BOOKED", notes: `Imported from partner ${partner.name}`, createdBy: systemUserId } })
      await tx.trackingEvent.create({ data: { shipmentId: shipment.id, event: "SHIPMENT_BOOKED", status: "BOOKED", description: `Shipment booked via partner integration (${partner.name})`, location: `${fromAddress.city}, ${fromAddress.country}`, createdBy: systemUserId } })

      return { shipment, order }
    })

    // Scoped to this partner only — they should never see another partner's subscription
    // trigger from their own API call.
    await emitEvent(EVENTS.SHIPMENT_CREATED, {
      shipment_id: shipment.id, tracking_number: shipment.trackingNumber, status: shipment.status,
      external_order_id: data.externalOrderId, external_shipment_id: data.externalShipmentId,
    }, { partnerId: partner.id })

    res.status(201).json({
      success: true,
      data: { ...toPartnerShipment({ ...shipment, order }), pricing: { total: quoteResult.total, currency: "TZS", etaMin: quoteResult.etaMin, etaMax: quoteResult.etaMax } },
      message: "Shipment created",
    })
  } catch (err) { next(err) }
}

export async function getPartnerShipment(req, res, next) {
  try {
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, partnerId: req.partner.id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })
    res.json({ success: true, data: toPartnerShipment(shipment) })
  } catch (err) { next(err) }
}

export async function listPartnerShipments(req, res, next) {
  try {
    const { page = 1, limit = 20, status } = req.query
    const where = { partnerId: req.partner.id }
    if (status) where.status = status
    const [shipments, total] = await Promise.all([
      prisma.shipment.findMany({ where, orderBy: { createdAt: "desc" }, take: Number(limit), skip: (Number(page) - 1) * Number(limit) }),
      prisma.shipment.count({ where }),
    ])
    res.json({ success: true, data: shipments.map(toPartnerShipment), meta: { page: Number(page), limit: Number(limit), total } })
  } catch (err) { next(err) }
}

export async function getPartnerShipmentTracking(req, res, next) {
  try {
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, partnerId: req.partner.id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const events = await prisma.trackingEvent.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { createdAt: "asc" },
      select: { event: true, status: true, description: true, location: true, createdAt: true },
    })

    res.json({ success: true, data: { trackingNumber: shipment.trackingNumber, status: shipment.status, events } })
  } catch (err) { next(err) }
}

export async function getPartnerShipmentPod(req, res, next) {
  try {
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, partnerId: req.partner.id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const images = await prisma.shipmentProofImage.findMany({ where: { shipmentId: shipment.id }, orderBy: { createdAt: "desc" } })
    res.json({
      success: true,
      data: {
        available: shipment.status === "DELIVERED" && images.length > 0,
        proofImages: images.map((i) => ({ imageUrl: i.imageUrl, createdAt: i.createdAt })),
      },
    })
  } catch (err) { next(err) }
}

export async function cancelPartnerShipment(req, res, next) {
  try {
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, partnerId: req.partner.id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    if (["DELIVERED", "IN_TRANSIT"].includes(shipment.status)) {
      return res.status(400).json({ success: false, message: "Cannot cancel a shipment that is in transit or delivered" })
    }

    const systemUserId = await getOrCreateIntegrationSystemUser()
    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.shipment.update({ where: { id: shipment.id }, data: { status: "CANCELLED" } })
      await tx.trackingEvent.create({ data: { shipmentId: shipment.id, event: "SHIPMENT_CANCELLED", status: "CANCELLED", description: `Cancelled via partner integration (${req.partner.name})`, createdBy: systemUserId } })
      return updated
    })

    await emitEvent(EVENTS.SHIPMENT_CANCELLED, { shipment_id: shipment.id, tracking_number: shipment.trackingNumber, status: "CANCELLED" }, { partnerId: req.partner.id })

    res.json({ success: true, data: toPartnerShipment(updated) })
  } catch (err) { next(err) }
}
