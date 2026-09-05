import prisma from "../../prisma/client.js"
import { universalBookingSchema, recommendModeSchema, bulkBookingSchema } from "./validation.js"
import { recommendTransportMode, getQuotesForRecommendations, generateBookingReference } from "./service.js"
import { calculateVolumetricWeight, getChargeableWeight, calculateQuote } from "../pricing/service.js"
import { triggerStatusNotification } from "../notification-service/controller.js"
import { createNotification } from "../notifications/controller.js"
import { logAction } from "../../middleware/audit-logger.js"

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

/**
 * GET /api/v1/booking/recommend
 * Recommend transport mode based on cargo details and route
 */
export async function recommendMode(req, res, next) {
  try {
    const data = recommendModeSchema.parse(req.body)
    const result = recommendTransportMode(data)

    // Also fetch pricing quotes for each recommendation
    const quotes = await getQuotesForRecommendations({
      recommendations: result.recommendations,
      category: data.originCountry.toLowerCase() === data.destCountry.toLowerCase() ? "DOMESTIC" : "INTERNATIONAL",
      originCity: data.originCity,
      destinationCity: data.destinationCity,
      originCountry: data.originCountry,
      destCountry: data.destCountry,
      actualWeightKg: data.weightKg,
      lengthCm: data.lengthCm,
      widthCm: data.widthCm,
      heightCm: data.heightCm,
      serviceLevel: data.serviceLevel || "STANDARD",
    })

    res.json({
      success: true,
      data: {
        ...result,
        quotes,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/booking/create
 * Universal booking - creates order + shipment with auto-recommended or customer-selected mode
 */
export async function createBooking(req, res, next) {
  try {
    const data = universalBookingSchema.parse(req.body)

    // Determine transport mode
    let transportMode = data.transportMode
    let vehicleCategory = data.vehicleCategory

    if (!transportMode) {
      // Auto-recommend mode
      const rec = recommendTransportMode({
        weightKg: data.weightKg,
        lengthCm: data.lengthCm,
        widthCm: data.widthCm,
        heightCm: data.heightCm,
        originCity: data.fromAddress.city,
        destinationCity: data.toAddress.city,
        originCountry: data.fromAddress.country,
        destCountry: data.toAddress.country,
        cargoType: data.cargoType,
        serviceLevel: data.serviceLevel,
      })

      if (rec.recommendations.length > 0) {
        transportMode = rec.recommendations[0].transportMode
        vehicleCategory = rec.recommendations[0].vehicleCategory
      } else {
        transportMode = "ROAD"
      }
    }

    // Determine category
    const isInternational = data.fromAddress.country.toLowerCase() !== data.toAddress.country.toLowerCase()
    const category = isInternational ? "INTERNATIONAL" : "DOMESTIC"

    // Calculate pricing
    const quoteResult = await calculateQuote({
      category,
      transportMode,
      serviceLevel: data.serviceLevel,
      originCity: data.fromAddress.city,
      destinationCity: data.toAddress.city,
      originCountry: data.fromAddress.country,
      destCountry: data.toAddress.country,
      actualWeightKg: data.weightKg,
      lengthCm: data.lengthCm,
      widthCm: data.widthCm,
      heightCm: data.heightCm,
      insuranceEnabled: data.insuranceEnabled,
      declaredValue: data.cargoValue || 0,
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
    const chargeableWeight = getChargeableWeight(data.weightKg, volumetricWeight)

    // Create order
    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        createdById: req.user.id,
        totalAmount: quoteResult.total,
        currency: "TZS",
        status: "CREATED",
        paymentStatus: "PENDING",
      },
    })

    // Generate tracking number
    const trackingNumber = generateBookingReference(transportMode)

    // Build shipment data
    const shipmentData = {
      trackingNumber,
      orderId: order.id,
      createdById: req.user.id,
      fromAddressId: fromAddress.id,
      toAddressId: toAddress.id,
      category,
      transportMode,
      serviceLevel: data.serviceLevel,
      fulfillmentType: data.fulfillmentType,
      status: "BOOKED",
      paymentStatus: "PENDING",
      actualWeightKg: data.weightKg,
      volumetricWeightKg: volumetricWeight,
      chargeableWeightKg: chargeableWeight,
      declaredValue: data.cargoValue || null,
      insuranceEnabled: data.insuranceEnabled,
      insurancePremium: quoteResult.insurancePremium || null,
      totalAmount: quoteResult.total,
      currency: "TZS",
      specialHandling: data.specialHandling,
      description: data.description,
      vehicleCategory: vehicleCategory || null,
      payer: data.payer === "COMPANY_ACCOUNT" ? "SENDER" : data.payer,
      isScheduled: data.isScheduled,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      otp: generateOtp(),
      isParcelDeliveryProofEnabled: true,
    }

    // Add SGR fields if rail
    if (transportMode === "RAIL" && data.sgrServiceType) {
      shipmentData.sgrServiceType = data.sgrServiceType
      shipmentData.originStationId = data.originStationId
      shipmentData.destinationStationId = data.destinationStationId
    }

    // Add Air Cargo fields if air
    if (transportMode === "AIR") {
      shipmentData.airCargoServiceType = data.airCargoServiceType || "AIRPORT_TO_AIRPORT"
      shipmentData.airportOrigin = data.originAirport
      shipmentData.airportDestination = data.destinationAirport
      shipmentData.cargoType = data.commodityType || (data.perishable ? "PERISHABLE" : data.dangerousGoodsDeclared ? "DANGEROUS" : "GENERAL")
    }

    // Link customer if exists
    const customer = await prisma.customer.findFirst({
      where: { userId: req.user.id },
    })
    if (customer) {
      shipmentData.customerId = customer.id
    }

    // Create shipment
    const shipment = await prisma.shipment.create({ data: shipmentData })

    // Create packages if provided
    if (data.packages && data.packages.length > 0) {
      await prisma.package.createMany({
        data: data.packages.map((pkg) => ({
          shipmentId: shipment.id,
          barcode: generateBarcode(),
          ...pkg,
        })),
      })
    } else {
      // Create a single package from booking data
      await prisma.package.create({
        data: {
          shipmentId: shipment.id,
          barcode: generateBarcode(),
          type: mapCargoTypeToPackageType(data.cargoType),
          weightKg: data.weightKg,
          lengthCm: data.lengthCm || null,
          widthCm: data.widthCm || null,
          heightCm: data.heightCm || null,
          volumetricWeightKg: volumetricWeight || null,
          declaredValue: data.cargoValue || null,
          description: data.description,
        },
      })
    }

    // Create tracking event
    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        event: "BOOKING_CREATED",
        status: "BOOKED",
        description: "Booking created successfully",
        createdBy: req.user.id,
      },
    })

    // Create status history
    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: shipment.id,
        status: "BOOKED",
        notes: `Booking created via universal booking - ${transportMode}`,
        createdBy: req.user.id,
      },
    })

    // Send notification
    try {
      await triggerStatusNotification(shipment.id, "BOOKED")
      await createNotification(req.user.id, "BOOKING_CONFIRMED", "Booking Confirmed", `Your shipment ${trackingNumber} has been booked successfully.`)
    } catch (e) {
      // Non-blocking
    }

    // Audit log
    await logAction({
      userId: req.user.id,
      action: "CREATE_BOOKING",
      entity: "Shipment",
      entityId: shipment.id,
      changes: { trackingNumber, transportMode, totalAmount: quoteResult.total },
      req,
    })

    // Fetch complete shipment with relations
    const fullShipment = await prisma.shipment.findUnique({
      where: { id: shipment.id },
      include: {
        order: true,
        fromAddress: true,
        toAddress: true,
        packages: true,
        trackingEvents: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    })

    res.status(201).json({
      success: true,
      data: {
        shipment: fullShipment,
        quote: quoteResult,
        recommendedMode: !data.transportMode,
        transportMode,
        vehicleCategory,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/v1/booking/bulk
 * Bulk booking for business accounts
 */
export async function bulkBooking(req, res, next) {
  try {
    const data = bulkBookingSchema.parse(req.body)

    // Check if user belongs to an organization
    const orgUser = await prisma.organizationUser.findFirst({
      where: { userId: req.user.id, isActive: true },
      include: { organization: true },
    })

    if (!orgUser) {
      return res.status(403).json({
        success: false,
        message: "Bulk booking is only available for business accounts",
      })
    }

    const results = []
    const errors = []

    for (let i = 0; i < data.shipments.length; i++) {
      try {
        const bookingData = data.shipments[i]

        // Process each booking (simplified - reuse createBooking logic)
        const isInternational = bookingData.fromAddress.country.toLowerCase() !== bookingData.toAddress.country.toLowerCase()
        const category = isInternational ? "INTERNATIONAL" : "DOMESTIC"

        let transportMode = bookingData.transportMode || "ROAD"
        let vehicleCategory = bookingData.vehicleCategory

        if (!transportMode) {
          const rec = recommendTransportMode({
            weightKg: bookingData.weightKg,
            lengthCm: bookingData.lengthCm,
            widthCm: bookingData.widthCm,
            heightCm: bookingData.heightCm,
            originCity: bookingData.fromAddress.city,
            destinationCity: bookingData.toAddress.city,
            originCountry: bookingData.fromAddress.country,
            destCountry: bookingData.toAddress.country,
            cargoType: bookingData.cargoType,
            serviceLevel: bookingData.serviceLevel,
          })
          if (rec.recommendations.length > 0) {
            transportMode = rec.recommendations[0].transportMode
            vehicleCategory = rec.recommendations[0].vehicleCategory
          }
        }

        const quoteResult = await calculateQuote({
          category,
          transportMode,
          serviceLevel: bookingData.serviceLevel,
          originCity: bookingData.fromAddress.city,
          destinationCity: bookingData.toAddress.city,
          originCountry: bookingData.fromAddress.country,
          destCountry: bookingData.toAddress.country,
          actualWeightKg: bookingData.weightKg,
          lengthCm: bookingData.lengthCm,
          widthCm: bookingData.widthCm,
          heightCm: bookingData.heightCm,
          insuranceEnabled: bookingData.insuranceEnabled,
          declaredValue: bookingData.cargoValue || 0,
        })

        if (quoteResult.requiresCustomQuote) {
          errors.push({ index: i, error: quoteResult.message })
          continue
        }

        const fromAddress = await prisma.address.create({ data: bookingData.fromAddress })
        const toAddress = await prisma.address.create({ data: bookingData.toAddress })

        const volumetricWeight = calculateVolumetricWeight(bookingData.lengthCm, bookingData.widthCm, bookingData.heightCm)
        const chargeableWeight = getChargeableWeight(bookingData.weightKg, volumetricWeight)

        const order = await prisma.order.create({
          data: {
            orderNumber: generateOrderNumber(),
            createdById: req.user.id,
            organizationId: orgUser.organizationId,
            totalAmount: quoteResult.total,
            currency: "TZS",
            status: "CREATED",
            paymentStatus: "PENDING",
          },
        })

        const trackingNumber = generateBookingReference(transportMode)

        const shipment = await prisma.shipment.create({
          data: {
            trackingNumber,
            orderId: order.id,
            createdById: req.user.id,
            organizationId: orgUser.organizationId,
            fromAddressId: fromAddress.id,
            toAddressId: toAddress.id,
            category,
            transportMode,
            serviceLevel: bookingData.serviceLevel,
            fulfillmentType: bookingData.fulfillmentType,
            status: "BOOKED",
            paymentStatus: "PENDING",
            actualWeightKg: bookingData.weightKg,
            volumetricWeightKg: volumetricWeight,
            chargeableWeightKg: chargeableWeight,
            declaredValue: bookingData.cargoValue || null,
            insuranceEnabled: bookingData.insuranceEnabled,
            insurancePremium: quoteResult.insurancePremium || null,
            totalAmount: quoteResult.total,
            currency: "TZS",
            specialHandling: bookingData.specialHandling,
            description: bookingData.description,
            vehicleCategory: vehicleCategory || null,
            payer: bookingData.payer === "COMPANY_ACCOUNT" ? "SENDER" : bookingData.payer,
            isScheduled: bookingData.isScheduled,
            scheduledAt: bookingData.scheduledAt ? new Date(bookingData.scheduledAt) : null,
            otp: generateOtp(),
            isParcelDeliveryProofEnabled: true,
          },
        })

        // Create package
        await prisma.package.create({
          data: {
            shipmentId: shipment.id,
            barcode: generateBarcode(),
            type: mapCargoTypeToPackageType(bookingData.cargoType),
            weightKg: bookingData.weightKg,
            description: bookingData.description,
          },
        })

        // Tracking event
        await prisma.trackingEvent.create({
          data: {
            shipmentId: shipment.id,
            event: "BOOKING_CREATED",
            status: "BOOKED",
            description: "Bulk booking created",
            createdBy: req.user.id,
          },
        })

        results.push({
          index: i,
          trackingNumber,
          shipmentId: shipment.id,
          totalAmount: quoteResult.total,
          transportMode,
        })
      } catch (err) {
        errors.push({ index: i, error: err.message })
      }
    }

    // Audit log
    await logAction({
      userId: req.user.id,
      action: "BULK_BOOKING",
      entity: "Shipment",
      changes: { count: results.length, errors: errors.length },
      req,
    })

    res.status(201).json({
      success: true,
      data: {
        created: results,
        errors,
        totalCreated: results.length,
        totalErrors: errors.length,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/booking/cargo-types
 * Get available cargo types
 */
export async function getCargoTypes(req, res, next) {
  try {
    const cargoTypes = [
      { value: "DOCUMENT", label: "Document", icon: "document", description: "Letters, contracts, certificates" },
      { value: "PARCEL", label: "Parcel", icon: "parcel", description: "Small to medium packages" },
      { value: "COMMERCIAL_CARGO", label: "Commercial Cargo", icon: "cargo", description: "Business goods and inventory" },
      { value: "ECOMMERCE_ORDER", label: "E-commerce Order", icon: "ecommerce", description: "Online store orders" },
      { value: "PALLET", label: "Pallet", icon: "pallet", description: "Palletized goods" },
      { value: "PERISHABLE_CARGO", label: "Perishable Cargo", icon: "perishable", description: "Food, flowers, temperature-sensitive" },
      { value: "FRAGILE_CARGO", label: "Fragile Cargo", icon: "fragile", description: "Glass, electronics, breakables" },
      { value: "MACHINERY_EQUIPMENT", label: "Machinery / Equipment", icon: "machinery", description: "Heavy equipment and machinery" },
      { value: "OTHER", label: "Other", icon: "other", description: "Any other type of cargo" },
    ]

    res.json({ success: true, data: cargoTypes })
  } catch (err) {
    next(err)
  }
}

function mapCargoTypeToPackageType(cargoType) {
  const mapping = {
    DOCUMENT: "DOCUMENT",
    PARCEL: "PARCEL",
    COMMERCIAL_CARGO: "CARGO",
    ECOMMERCE_ORDER: "PARCEL",
    PALLET: "PALLET",
    PERISHABLE_CARGO: "CARGO",
    FRAGILE_CARGO: "BOX",
    MACHINERY_EQUIPMENT: "CRATE",
    OTHER: "OTHER",
  }
  return mapping[cargoType] || "PARCEL"
}
