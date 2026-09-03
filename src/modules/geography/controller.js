import prisma from "../../prisma/client.js"
import { z } from "zod"

const createCountrySchema = z.object({
  code: z.string().min(2).max(3),
  name: z.string().min(2),
  currency: z.string().default("TZS"),
})

const createCitySchema = z.object({
  countryId: z.string(),
  regionId: z.string().optional(),
  name: z.string().min(2),
  code: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
})

const createRouteSchema = z.object({
  fromCityId: z.string(),
  toCityId: z.string(),
  distanceKm: z.number().min(0),
  estimatedHours: z.number().optional(),
})

export async function listCountries(req, res, next) {
  try {
    const countries = await prisma.country.findMany({ where: { isActive: true }, include: { _count: { select: { cities: true } } } })
    res.json({ success: true, data: countries })
  } catch (err) { next(err) }
}

export async function createCountry(req, res, next) {
  try {
    const data = createCountrySchema.parse(req.body)
    const country = await prisma.country.create({ data })
    res.status(201).json({ success: true, data: country })
  } catch (err) { next(err) }
}

export async function listCities(req, res, next) {
  try {
    const { countryId } = req.query
    const where = { isActive: true }
    if (countryId) where.countryId = countryId
    const cities = await prisma.city.findMany({ where, include: { country: true, region: true } })
    res.json({ success: true, data: cities })
  } catch (err) { next(err) }
}

export async function createCity(req, res, next) {
  try {
    const data = createCitySchema.parse(req.body)
    const city = await prisma.city.create({ data })
    res.status(201).json({ success: true, data: city })
  } catch (err) { next(err) }
}

export async function listRoutes(req, res, next) {
  try {
    const routes = await prisma.route.findMany({
      where: { isActive: true },
      include: { fromCity: true, toCity: true },
    })
    res.json({ success: true, data: routes })
  } catch (err) { next(err) }
}

export async function createRoute(req, res, next) {
  try {
    const data = createRouteSchema.parse(req.body)
    const route = await prisma.route.create({ data })
    res.status(201).json({ success: true, data: route })
  } catch (err) { next(err) }
}
