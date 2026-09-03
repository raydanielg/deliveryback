import { Router } from "express"
import { listCountries, createCountry, listCities, createCity, listRoutes, createRoute } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

/**
 * @swagger
 * /api/v1/geography/countries:
 *   get:
 *     summary: List all countries (public)
 *     description: Returns all countries available in the system. No authentication required.
 *     tags: [Geography]
 *     responses:
 *       200:
 *         description: List of countries
 */
router.get("/countries", listCountries)

/**
 * @swagger
 * /api/v1/geography/cities:
 *   get:
 *     summary: List all cities (public)
 *     description: Returns all cities available in the system. No authentication required.
 *     tags: [Geography]
 *     parameters:
 *       - in: query
 *         name: countryId
 *         schema: { type: string }
 *         description: Filter cities by country
 *     responses:
 *       200:
 *         description: List of cities
 */
router.get("/cities", listCities)

/**
 * @swagger
 * /api/v1/geography/routes:
 *   get:
 *     summary: List all routes (public)
 *     description: Returns all delivery routes available in the system. No authentication required.
 *     tags: [Geography]
 *     responses:
 *       200:
 *         description: List of routes
 */
router.get("/routes", listRoutes)

router.use(authenticate)

/**
 * @swagger
 * /api/v1/geography/countries:
 *   post:
 *     summary: Create a country (super admin only)
 *     tags: [Geography]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               code: { type: string, maxLength: 3 }
 *               currency: { type: string }
 *     responses:
 *       201:
 *         description: Country created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/countries", authorizeRoles("SUPER_ADMIN"), createCountry)

/**
 * @swagger
 * /api/v1/geography/cities:
 *   post:
 *     summary: Create a city
 *     tags: [Geography]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               countryId: { type: string }
 *               region: { type: string }
 *     responses:
 *       201:
 *         description: City created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/cities", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createCity)

/**
 * @swagger
 * /api/v1/geography/routes:
 *   post:
 *     summary: Create a delivery route
 *     tags: [Geography]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               originCityId: { type: string }
 *               destinationCityId: { type: string }
 *               distanceKm: { type: number }
 *               estimatedHours: { type: number }
 *     responses:
 *       201:
 *         description: Route created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/routes", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createRoute)

export default router
