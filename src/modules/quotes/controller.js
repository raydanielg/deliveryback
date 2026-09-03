import prisma from "../../prisma/client.js"
import { calculateQuote, generateMultipleQuotes } from "../pricing/service.js"
import { calculateQuoteSchema, createQuoteRequestSchema, respondToQuoteRequestSchema, customerRespondSchema } from "./validation.js"

function generateQuoteNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, "0")
  return `QT-${year}-${random}`
}

function generateRequestNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, "0")
  return `QR-${year}-${random}`
}

export async function calculateQuoteHandler(req, res, next) {
  try {
    const data = calculateQuoteSchema.parse(req.body)
    const result = await calculateQuote(data)
    res.json({ success: true, data: result })
  } catch (err) { next(err) }
}

export async function getMultipleQuotes(req, res, next) {
  try {
    const data = calculateQuoteSchema.parse(req.body)
    const quotes = await generateMultipleQuotes(data)
    res.json({ success: true, data: quotes })
  } catch (err) { next(err) }
}

export async function saveQuote(req, res, next) {
  try {
    const data = calculateQuoteSchema.parse(req.body)
    const result = await calculateQuote(data)

    if (result.requiresCustomQuote) {
      return res.status(400).json({
        success: false,
        message: result.message,
      })
    }

    const quote = await prisma.quote.create({
      data: {
        quoteNumber: generateQuoteNumber(),
        createdById: req.user.id,
        category: data.category,
        transportMode: data.transportMode || null,
        serviceLevel: data.serviceLevel || "STANDARD",
        originCity: data.originCity,
        destinationCity: data.destinationCity,
        originCountry: data.originCountry,
        destCountry: data.destCountry,
        distanceKm: result.distanceKm,
        actualWeightKg: result.actualWeightKg,
        volumetricWeightKg: result.volumetricWeightKg,
        chargeableWeightKg: result.chargeableWeightKg,
        lengthCm: data.lengthCm || null,
        widthCm: data.widthCm || null,
        heightCm: data.heightCm || null,
        currency: result.currency,
        subtotal: result.subtotal,
        fees: result.fees,
        tax: result.tax,
        insurancePremium: result.insurancePremium,
        total: result.total,
        etaMin: result.etaMin,
        etaMax: result.etaMax,
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })

    res.status(201).json({ success: true, data: quote })
  } catch (err) { next(err) }
}

export async function listQuotes(req, res, next) {
  try {
    const quotes = await prisma.quote.findMany({
      where: { createdById: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    res.json({ success: true, data: quotes })
  } catch (err) { next(err) }
}

export async function getQuote(req, res, next) {
  try {
    const { id } = req.params
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: { order: true },
    })
    if (!quote) return res.status(404).json({ success: false, message: "Quote not found" })
    res.json({ success: true, data: quote })
  } catch (err) { next(err) }
}

// Quote Requests (for heavy cargo / custom quotes)
export async function createQuoteRequest(req, res, next) {
  try {
    const data = createQuoteRequestSchema.parse(req.body)

    const HEAVY_CARGO_THRESHOLD = 100

    const request = await prisma.quoteRequest.create({
      data: {
        requestNumber: generateRequestNumber(),
        createdById: req.user.id,
        category: data.category,
        transportMode: data.transportMode || null,
        originCity: data.originCity,
        destinationCity: data.destinationCity,
        originCountry: data.originCountry,
        destCountry: data.destCountry,
        weightKg: data.weightKg,
        lengthCm: data.lengthCm || null,
        widthCm: data.widthCm || null,
        heightCm: data.heightCm || null,
        description: data.description,
        specialHandling: data.specialHandling,
        status: "PENDING",
      },
    })

    res.status(201).json({ success: true, data: request })
  } catch (err) { next(err) }
}

export async function listQuoteRequests(req, res, next) {
  try {
    const where = {}
    if (req.user.role === "CUSTOMER") {
      where.createdById = req.user.id
    }

    const requests = await prisma.quoteRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    res.json({ success: true, data: requests })
  } catch (err) { next(err) }
}

export async function respondToQuoteRequest(req, res, next) {
  try {
    const { id } = req.params
    const data = respondToQuoteRequestSchema.parse(req.body)

    const request = await prisma.quoteRequest.update({
      where: { id },
      data: {
        quotedPrice: data.quotedPrice,
        quotedCurrency: data.quotedCurrency,
        validityDays: data.validityDays,
        adminNotes: data.adminNotes,
        status: "QUOTED",
      },
    })

    res.json({ success: true, data: request })
  } catch (err) { next(err) }
}

export async function customerRespondToQuote(req, res, next) {
  try {
    const { id } = req.params
    const data = customerRespondSchema.parse(req.body)

    const statusMap = {
      ACCEPT: "ACCEPTED",
      REJECT: "REJECTED",
      REQUEST_REVISION: "REVISION_REQUESTED",
    }

    const request = await prisma.quoteRequest.update({
      where: { id },
      data: { status: statusMap[data.action] },
    })

    res.json({ success: true, data: request })
  } catch (err) { next(err) }
}
