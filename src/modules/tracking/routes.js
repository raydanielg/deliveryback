import { Router } from "express"
import {
  updateDriverLocation, getDriverLocation,
  getShipmentTracking, addTrackingEvent,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

/**
 * @swagger
 * /api/v1/tracking/shipments/{trackingNumber}:
 *   get:
 *     summary: Track shipment by tracking number (public)
 *     description: Public endpoint that returns real-time tracking information for a shipment. No authentication required.
 *     tags: [Tracking]
 *     parameters:
 *       - in: path
 *         name: trackingNumber
 *         required: true
 *         schema: { type: string }
 *         description: Tracking number (e.g. XRD-2026-123456)
 *     responses:
 *       200:
 *         description: Shipment tracking details including current status, location, and timeline
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object, properties: { trackingNumber: { type: string }, status: { type: string }, events: { type: array } } }
 *       404:
 *         description: Shipment not found
 */
router.get("/shipments/:trackingNumber", getShipmentTracking)

router.use(authenticate)

/**
 * @swagger
 * /api/v1/tracking/driver/location:
 *   post:
 *     summary: Update driver location (driver only)
 *     description: Called by driver app to update real-time GPS location for live tracking.
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               heading: { type: number, description: "Direction in degrees" }
 *               speed: { type: number, description: "Speed in km/h" }
 *     responses:
 *       200:
 *         description: Location updated
 *       403:
 *         description: Driver role required
 */
router.post("/driver/location", authorizeRoles("DRIVER"), updateDriverLocation)

/**
 * @swagger
 * /api/v1/tracking/driver/{driverId}:
 *   get:
 *     summary: Get driver's current location
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Driver location data
 *       404:
 *         description: Driver not found or no location data
 */
router.get("/driver/:driverId", getDriverLocation)

/**
 * @swagger
 * /api/v1/tracking/shipments/{shipmentId}/events:
 *   post:
 *     summary: Add a tracking event to a shipment
 *     description: Adds a custom tracking event (e.g. checkpoint reached, delay notification) to the shipment timeline.
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [event]
 *             properties:
 *               event: { type: string, description: "Event type (e.g. PICKED_UP, IN_TRANSIT, DELIVERED)" }
 *               location: { type: string }
 *               notes: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       201:
 *         description: Tracking event added
 *       404:
 *         description: Shipment not found
 */
router.post("/shipments/:shipmentId/events", addTrackingEvent)

export default router
