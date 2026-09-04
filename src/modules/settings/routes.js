import { Router } from "express"
import { getMapSettings, updateMapSettings, getPublicMapSettings } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

/**
 * @swagger
 * /api/v1/settings/public-map:
 *   get:
 *     summary: Get public map configuration (public)
 *     description: Returns client-safe map configuration for mobile apps and web frontend. Includes tile server URLs, default viewport, and theme settings. No sensitive credentials are exposed.
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Public map configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object, properties: { tileUrl: { type: string }, defaultLat: { type: number }, defaultLng: { type: number }, defaultZoom: { type: integer }, theme: { type: string } } }
 */
router.get("/public-map", getPublicMapSettings)

/**
 * @swagger
 * /api/v1/settings/map:
 *   get:
 *     summary: Get map settings (admin)
 *     description: Returns full map configuration including API keys for Google Maps, Mapbox, MapTiler. Admin/Operations/Dispatcher only. Sensitive credentials are masked.
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Map configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object, properties: { googleMapsApiKey: { type: string }, mapboxToken: { type: string }, mapTilerKey: { type: string }, tileUrl: { type: string }, defaultLat: { type: number }, defaultLng: { type: number }, defaultZoom: { type: integer }, geocodingEngine: { type: string }, liveTraffic: { type: boolean }, refreshInterval: { type: integer } } }
 *       403:
 *         description: Insufficient permissions
 */
router.get("/map", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"]), getMapSettings)

/**
 * @swagger
 * /api/v1/settings/map:
 *   put:
 *     summary: Update map settings (admin)
 *     description: Saves map provider credentials and configuration. Admin/Operations Manager only.
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               googleMapsApiKey: { type: string, description: "Google Maps API key" }
 *               mapboxToken: { type: string, description: "Mapbox public access token" }
 *               mapTilerKey: { type: string, description: "MapTiler API key" }
 *               tileUrl: { type: string, description: "Custom tile URL template" }
 *               defaultLat: { type: number }
 *               defaultLng: { type: number }
 *               defaultZoom: { type: integer, min: 1, max: 20 }
 *               geocodingEngine: { type: string, enum: [OSM_NOMINATIM, GOOGLE_PLACES, MAPBOX_GEOCODING] }
 *               liveTraffic: { type: boolean }
 *               driverRadarAnimation: { type: boolean }
 *               vehicleClustering: { type: boolean }
 *               refreshInterval: { type: integer, enum: [3, 5, 10, 30] }
 *     responses:
 *       200:
 *         description: Map settings updated
 *       403:
 *         description: Insufficient permissions
 */
router.put("/map", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"]), updateMapSettings)

export default router
