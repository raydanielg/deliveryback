import prisma from "../../prisma/client.js"
import { createParcelFareSchema, createParcelFareWeightSchema } from "./validation.js"

// --- Parcel Fares ---

export async function listParcelFares(req, res, next) {
  try {
    const fares = await prisma.parcelFare.findMany({
      include: { fareWeights: { include: { parcelWeight: true, parcelCategory: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: fares })
  } catch (err) { next(err) }
}

export async function createParcelFare(req, res, next) {
  try {
    const data = createParcelFareSchema.parse(req.body)
    const fare = await prisma.parcelFare.create({ data })
    res.status(201).json({ success: true, data: fare })
  } catch (err) { next(err) }
}

export async function updateParcelFare(req, res, next) {
  try {
    const { id } = req.params
    const data = createParcelFareSchema.partial().parse(req.body)
    const fare = await prisma.parcelFare.update({ where: { id }, data })
    res.json({ success: true, data: fare })
  } catch (err) { next(err) }
}

export async function deleteParcelFare(req, res, next) {
  try {
    const { id } = req.params
    await prisma.parcelFare.delete({ where: { id } })
    res.json({ success: true, message: "Parcel fare deleted" })
  } catch (err) { next(err) }
}

// --- Parcel Fare Weights ---

export async function listParcelFareWeights(req, res, next) {
  try {
    const fareWeights = await prisma.parcelFareWeight.findMany({
      include: { parcelFare: true, parcelWeight: true, parcelCategory: true },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: fareWeights })
  } catch (err) { next(err) }
}

export async function createParcelFareWeight(req, res, next) {
  try {
    const data = createParcelFareWeightSchema.parse(req.body)
    const fareWeight = await prisma.parcelFareWeight.create({ data })
    res.status(201).json({ success: true, data: fareWeight })
  } catch (err) { next(err) }
}

export async function updateParcelFareWeight(req, res, next) {
  try {
    const { id } = req.params
    const data = createParcelFareWeightSchema.partial().parse(req.body)
    const fareWeight = await prisma.parcelFareWeight.update({ where: { id }, data })
    res.json({ success: true, data: fareWeight })
  } catch (err) { next(err) }
}

export async function deleteParcelFareWeight(req, res, next) {
  try {
    const { id } = req.params
    await prisma.parcelFareWeight.delete({ where: { id } })
    res.json({ success: true, message: "Fare weight deleted" })
  } catch (err) { next(err) }
}

// --- Fare Estimation ---

export async function estimateParcelFare(req, res, next) {
  try {
    const { parcelCategoryId, weightKg, distanceKm, zoneId } = req.query

    const where = { isActive: true }
    if (zoneId) where.zoneId = zoneId

    const fare = await prisma.parcelFare.findFirst({ where })
    if (!fare) return res.status(404).json({ success: false, message: "No active fare found for the given criteria" })

    // Find matching weight tier
    const weight = parseFloat(weightKg || "0")
    const fareWeightWhere = { parcelFareId: fare.id }
    if (parcelCategoryId) fareWeightWhere.parcelCategoryId = parcelCategoryId

    const fareWeights = await prisma.parcelFareWeight.findMany({
      where: fareWeightWhere,
      include: { parcelWeight: true },
    })

    let matchedFareWeight = null
    for (const fw of fareWeights) {
      if (weight >= fw.parcelWeight.minWeight && weight <= fw.parcelWeight.maxWeight) {
        matchedFareWeight = fw
        break
      }
    }

    const distKm = parseFloat(distanceKm || "0")
    let baseFare = matchedFareWeight ? matchedFareWeight.baseFare : fare.baseFare
    let perKm = matchedFareWeight ? matchedFareWeight.farePerKm : fare.baseFarePerKm

    const totalFare = baseFare + (perKm * distKm)
    const returnFee = matchedFareWeight ? matchedFareWeight.returnFee : fare.returnFee
    const cancellationFee = matchedFareWeight ? matchedFareWeight.cancellationFee : fare.cancellationFee

    res.json({
      success: true,
      data: {
        baseFare,
        perKm,
        distanceKm: distKm,
        totalFare: Math.round(totalFare * 100) / 100,
        returnFee,
        cancellationFee,
        weightTier: matchedFareWeight ? matchedFareWeight.parcelWeight : null,
      },
    })
  } catch (err) { next(err) }
}
