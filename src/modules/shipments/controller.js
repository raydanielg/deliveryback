import prisma from "../../prisma/client.js"
import fs from "fs/promises"
import path from "path"
import { calculateQuote } from "../pricing/service.js"
import { calculateVolumetricWeight, getChargeableWeight } from "../pricing/service.js"
import { triggerStatusNotification } from "../notification-service/controller.js"
import { createShipmentSchema, updateShipmentStatusSchema, assignShipmentSchema, verifyOtpSchema, uploadProofSchema, scheduleShipmentSchema, createParcelShipmentSchema } from "./validation.js"

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

function generateOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString()
}

export async function createShipment(req, res, next) {
  try {
    const data = createShipmentSchema.parse(req.body)

    // Calculate pricing
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
      return res.status(400).json({
        success: false,
        message: quoteResult.message,
      })
    }

    // Create addresses
    const fromAddress = await prisma.address.create({ data: data.fromAddress })
    const toAddress = await prisma.address.create({ data: data.toAddress })

    // Calculate weights
    const volumetricWeight = calculateVolumetricWeight(data.lengthCm, data.widthCm, data.heightCm)
    const chargeableWeight = getChargeableWeight(data.actualWeightKg, volumetricWeight)

    // Create order
    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        createdById: req.user.id,
        totalAmount: quoteResult.total,
        currency: quoteResult.currency,
        status: "CREATED",
        paymentStatus: "PENDING",
      },
    })

    // Create shipment
    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber: generateTrackingNumber(),
        orderId: order.id,
        createdById: req.user.id,
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
        currency: quoteResult.currency,
        specialHandling: data.specialHandling,
        description: data.description || null,
        estimatedPickup: data.estimatedPickup ? new Date(data.estimatedPickup) : null,
        estimatedDelivery: data.estimatedDelivery ? new Date(data.estimatedDelivery) : null,
      },
      include: {
        fromAddress: true,
        toAddress: true,
        order: true,
      },
    })

    // Create packages if provided
    if (data.packages && data.packages.length > 0) {
      for (const pkg of data.packages) {
        await prisma.package.create({
          data: {
            shipmentId: shipment.id,
            barcode: generateBarcode(),
            type: pkg.type,
            weightKg: pkg.weightKg,
            lengthCm: pkg.lengthCm || null,
            widthCm: pkg.widthCm || null,
            heightCm: pkg.heightCm || null,
            declaredValue: pkg.declaredValue || null,
            description: pkg.description || null,
            isFragile: pkg.isFragile,
          },
        })
      }
    }

    // Create initial status history
    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: shipment.id,
        status: "BOOKED",
        notes: "Shipment booked",
        createdBy: req.user.id,
      },
    })

    // Create initial tracking event
    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        event: "SHIPMENT_BOOKED",
        status: "BOOKED",
        description: `Shipment ${shipment.trackingNumber} has been booked`,
        location: `${fromAddress.city}, ${fromAddress.country}`,
        createdBy: req.user.id,
      },
    })

    res.status(201).json({
      success: true,
      message: "Shipment created successfully",
      data: {
        shipment,
        order,
        pricing: quoteResult,
      },
    })
  } catch (err) { next(err) }
}

export async function listShipments(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const status = req.query.status
    const category = req.query.category

    const where = {}
    if (status) where.status = status
    if (category) where.category = category

    if (req.user.role === "CUSTOMER") {
      where.createdById = req.user.id
    }

    const [shipments, total] = await Promise.all([
      prisma.shipment.findMany({
        where,
        include: {
          fromAddress: true,
          toAddress: true,
          order: true,
          packages: true,
          driver: { include: { user: { select: { name: true, phone: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.shipment.count({ where }),
    ])

    res.json({
      success: true,
      data: shipments,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) { next(err) }
}

export async function getShipment(req, res, next) {
  try {
    const { id } = req.params
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        fromAddress: true,
        toAddress: true,
        order: { include: { payments: true, invoices: true } },
        packages: true,
        trackingEvents: { orderBy: { createdAt: "desc" } },
        statusHistory: { orderBy: { createdAt: "desc" } },
        driver: { include: { user: { select: { name: true, phone: true } } } },
        vehicle: true,
        carrier: true,
        assignments: true,
        customsDeclaration: true,
        documents: true,
        ratings: true,
      },
    })

    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    res.json({ success: true, data: shipment })
  } catch (err) { next(err) }
}

export async function getShipmentByTracking(req, res, next) {
  try {
    const { trackingNumber } = req.params
    const shipment = await prisma.shipment.findUnique({
      where: { trackingNumber },
      include: {
        fromAddress: true,
        toAddress: true,
        trackingEvents: { orderBy: { createdAt: "desc" } },
        statusHistory: { orderBy: { createdAt: "desc" } },
        packages: true,
      },
    })

    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    res.json({ success: true, data: shipment })
  } catch (err) { next(err) }
}

export async function updateShipmentStatus(req, res, next) {
  try {
    const { id } = req.params
    const data = updateShipmentStatusSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        status: data.status,
        actualDelivery: data.status === "DELIVERED" ? new Date() : undefined,
        actualPickup: data.status === "PICKED_UP" ? new Date() : undefined,
      },
    })

    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: id,
        status: data.status,
        notes: data.notes,
        location: data.location,
        latitude: data.latitude,
        longitude: data.longitude,
        createdBy: req.user?.id,
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: id,
        event: `STATUS_${data.status}`,
        status: data.status,
        description: data.notes || `Status updated to ${data.status}`,
        location: data.location,
        latitude: data.latitude,
        longitude: data.longitude,
        createdBy: req.user?.id,
      },
    })

    triggerStatusNotification(id, data.status)

    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}

export async function assignShipment(req, res, next) {
  try {
    const { id } = req.params
    const data = assignShipmentSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const assignment = await prisma.assignment.create({
      data: {
        shipmentId: id,
        driverId: data.driverId,
        vehicleId: data.vehicleId,
        assignedById: req.user.id,
        status: "ASSIGNED",
      },
    })

    await prisma.shipment.update({
      where: { id },
      data: {
        driverId: data.driverId,
        vehicleId: data.vehicleId,
        status: "DRIVER_ASSIGNED",
        otp: generateOtp(),
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: id,
        event: "DRIVER_ASSIGNED",
        status: "DRIVER_ASSIGNED",
        description: "Driver has been assigned to this shipment",
        createdBy: req.user.id,
      },
    })

    res.json({ success: true, data: assignment })
  } catch (err) { next(err) }
}

export async function cancelShipment(req, res, next) {
  try {
    const { id } = req.params
    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    if (["DELIVERED", "IN_TRANSIT"].includes(shipment.status)) {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel a shipment that is in transit or delivered",
      })
    }

    const updated = await prisma.shipment.update({
      where: { id },
      data: { status: "CANCELLED" },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: id,
        event: "SHIPMENT_CANCELLED",
        status: "CANCELLED",
        description: "Shipment has been cancelled",
        createdBy: req.user.id,
      },
    })

    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}

export async function getShipmentStats(req, res, next) {
  try {
    const [total, active, delivered, cancelled, inTransit, scheduled] = await Promise.all([
      prisma.shipment.count(),
      prisma.shipment.count({ where: { status: { in: ["PENDING", "BOOKED", "AWAITING_PICKUP", "DRIVER_ASSIGNED", "ACCEPTED", "OUT_FOR_PICKUP", "PICKED_UP", "IN_TRANSIT", "ONGOING", "OUT_FOR_DELIVERY"] } } }),
      prisma.shipment.count({ where: { status: "DELIVERED" } }),
      prisma.shipment.count({ where: { status: "CANCELLED" } }),
      prisma.shipment.count({ where: { status: { in: ["IN_TRANSIT", "ONGOING"] } } }),
      prisma.shipment.count({ where: { isScheduled: true, status: { notIn: ["DELIVERED", "CANCELLED"] } } }),
    ])

    res.json({
      success: true,
      data: { total, active, delivered, cancelled, inTransit, scheduled },
    })
  } catch (err) { next(err) }
}

// ============================================================
// OTP VERIFICATION (from drivemond)
// ============================================================

export async function verifyPickupOtp(req, res, next) {
  try {
    const { id } = req.params
    const { otp } = verifyOtpSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    if (shipment.otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" })
    }

    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        status: "PICKED_UP",
        actualPickup: new Date(),
      },
    })

    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: id,
        status: "PICKED_UP",
        notes: "OTP verified, parcel picked up",
        createdBy: req.user?.id,
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: id,
        event: "OTP_VERIFIED_PICKUP",
        status: "PICKED_UP",
        description: "OTP verified and parcel has been picked up",
        createdBy: req.user?.id,
      },
    })

    res.json({ success: true, data: updated, message: "OTP verified successfully" })
  } catch (err) { next(err) }
}

export async function verifyDeliveryOtp(req, res, next) {
  try {
    const { id } = req.params
    const { otp } = verifyOtpSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    if (shipment.otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" })
    }

    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        status: "DELIVERED",
        actualDelivery: new Date(),
      },
    })

    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: id,
        status: "DELIVERED",
        notes: "OTP verified, parcel delivered",
        createdBy: req.user?.id,
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: id,
        event: "OTP_VERIFIED_DELIVERY",
        status: "DELIVERED",
        description: "OTP verified and parcel has been delivered",
        createdBy: req.user?.id,
      },
    })

    res.json({ success: true, data: updated, message: "Delivery confirmed successfully" })
  } catch (err) { next(err) }
}

// ============================================================
// PROOF OF DELIVERY (from drivemond)
// ============================================================

export async function uploadProofOfDelivery(req, res, next) {
  try {
    const { id } = req.params
    let imageUrl = req.body.imageUrl
    const notes = req.body.notes

    // Handle file upload via multer
    if (req.file) {
      const ext = req.file.originalname.split(".").pop() || "jpg"
      const filename = `proof-${id}-${Date.now()}.${ext}`
      const uploadsDir = path.join(process.cwd(), "uploads", "proof")
      await fs.mkdir(uploadsDir, { recursive: true })
      await fs.writeFile(path.join(uploadsDir, filename), req.file.buffer)
      imageUrl = `/uploads/proof/${filename}`
    }

    if (!imageUrl) {
      return res.status(400).json({ success: false, message: "Image file or imageUrl is required" })
    }

    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const proofImage = await prisma.shipmentProofImage.create({
      data: {
        shipmentId: id,
        imageUrl,
        uploadedBy: req.user?.id,
      },
    })

    await prisma.shipment.update({
      where: { id },
      data: { proofImageUrl: imageUrl },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: id,
        event: "PROOF_OF_DELIVERY_UPLOADED",
        status: shipment.status,
        description: notes || "Proof of delivery image uploaded",
        createdBy: req.user?.id,
      },
    })

    res.status(201).json({ success: true, data: proofImage, message: "Proof of delivery uploaded" })
  } catch (err) { next(err) }
}

export async function getProofImages(req, res, next) {
  try {
    const { id } = req.params
    const images = await prisma.shipmentProofImage.findMany({
      where: { shipmentId: id },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: images })
  } catch (err) { next(err) }
}

// ============================================================
// SCHEDULED DELIVERY (from drivemond - supports hours to weeks)
// ============================================================

export async function scheduleShipment(req, res, next) {
  try {
    const { id } = req.params
    const { scheduledAt, note } = scheduleShipmentSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const scheduledDate = new Date(scheduledAt)
    const now = new Date()
    const diffHours = (scheduledDate - now) / (1000 * 60 * 60)

    if (diffHours < 1) {
      return res.status(400).json({ success: false, message: "Scheduled time must be at least 1 hour from now" })
    }

    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        isScheduled: true,
        scheduledAt: scheduledDate,
        note: note || shipment.note,
        estimatedPickup: scheduledDate,
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: id,
        event: "SHIPMENT_SCHEDULED",
        status: shipment.status,
        description: `Shipment scheduled for ${scheduledDate.toISOString()}`,
        createdBy: req.user?.id,
      },
    })

    res.json({ success: true, data: updated, message: "Shipment scheduled successfully" })
  } catch (err) { next(err) }
}

export async function listScheduledShipments(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20

    const where = {
      isScheduled: true,
      status: { notIn: ["DELIVERED", "CANCELLED"] },
    }

    if (req.user.role === "CUSTOMER") {
      where.createdById = req.user.id
    }

    const [shipments, total] = await Promise.all([
      prisma.shipment.findMany({
        where,
        include: {
          fromAddress: true,
          toAddress: true,
          order: true,
          driver: { include: { user: { select: { name: true, phone: true } } } },
        },
        orderBy: { scheduledAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.shipment.count({ where }),
    ])

    res.json({
      success: true,
      data: shipments,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) { next(err) }
}

// ============================================================
// PARCEL SHIPMENT CREATION (from drivemond flow)
// ============================================================

export async function createParcelShipment(req, res, next) {
  try {
    const data = createParcelShipmentSchema.parse(req.body)

    // Create addresses
    const fromAddress = await prisma.address.create({ data: data.fromAddress })
    const toAddress = await prisma.address.create({ data: data.toAddress })

    // Get parcel fare estimate
    const parcelFare = await prisma.parcelFare.findFirst({
      where: { isActive: true },
    })

    let totalAmount = 0
    if (parcelFare) {
      const fareWeights = await prisma.parcelFareWeight.findMany({
        where: { parcelFareId: parcelFare.id, parcelCategoryId: data.parcelCategoryId },
        include: { parcelWeight: true },
      })

      let matchedFareWeight = null
      for (const fw of fareWeights) {
        if (data.actualWeightKg >= fw.parcelWeight.minWeight && data.actualWeightKg <= fw.parcelWeight.maxWeight) {
          matchedFareWeight = fw
          break
        }
      }

      totalAmount = matchedFareWeight ? matchedFareWeight.baseFare : parcelFare.baseFare
    }

    const tips = data.tips || 0
    totalAmount = totalAmount + tips

    // Create order
    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        createdById: req.user.id,
        totalAmount,
        currency: "TZS",
        status: "CREATED",
        paymentStatus: "PENDING",
      },
    })

    // Create shipment with parcel flow fields
    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber: generateTrackingNumber(),
        orderId: order.id,
        createdById: req.user.id,
        fromAddressId: fromAddress.id,
        toAddressId: toAddress.id,
        category: "DOMESTIC",
        transportMode: "COURIER",
        serviceLevel: "STANDARD",
        fulfillmentType: "DOOR_TO_DOOR",
        status: "PENDING",
        paymentStatus: "PENDING",
        actualWeightKg: data.actualWeightKg,
        chargeableWeightKg: data.actualWeightKg,
        totalAmount,
        currency: "TZS",
        description: data.description || null,
        parcelCategoryId: data.parcelCategoryId,
        payer: data.payer,
        isScheduled: data.isScheduled,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        note: data.note || null,
        pickupNote: data.pickupNote || null,
        isParcelDeliveryProofEnabled: data.isParcelDeliveryProofEnabled,
        tips: tips || null,
        estimatedPickup: data.scheduledAt ? new Date(data.scheduledAt) : null,
      },
      include: {
        fromAddress: true,
        toAddress: true,
        order: true,
        parcelCategory: true,
      },
    })

    // Create initial status history
    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: shipment.id,
        status: "PENDING",
        notes: "Parcel shipment created",
        createdBy: req.user.id,
      },
    })

    // Create initial tracking event
    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        event: "PARCEL_CREATED",
        status: "PENDING",
        description: `Parcel shipment ${shipment.trackingNumber} has been created`,
        location: `${fromAddress.city}, ${fromAddress.country}`,
        createdBy: req.user.id,
      },
    })

    res.status(201).json({
      success: true,
      message: "Parcel shipment created successfully",
      data: {
        shipment,
        order,
      },
    })
  } catch (err) { next(err) }
}

// ============================================================
// SHIPMENT CANCELLATION WITH REASON (from drivemond)
// ============================================================

export async function cancelShipmentWithReason(req, res, next) {
  try {
    const { id } = req.params
    const { reason, notes } = req.body

    const shipment = await prisma.shipment.findUnique({ where: { id } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    if (["DELIVERED", "IN_TRANSIT", "ONGOING"].includes(shipment.status)) {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel a shipment that is in transit or delivered",
      })
    }

    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancellationReason: reason || null,
      },
    })

    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: id,
        status: "CANCELLED",
        notes: notes || `Cancelled: ${reason || "No reason provided"}`,
        createdBy: req.user?.id,
      },
    })

    await prisma.trackingEvent.create({
      data: {
        shipmentId: id,
        event: "SHIPMENT_CANCELLED",
        status: "CANCELLED",
        description: `Shipment cancelled: ${reason || "No reason provided"}`,
        createdBy: req.user?.id,
      },
    })

    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}
