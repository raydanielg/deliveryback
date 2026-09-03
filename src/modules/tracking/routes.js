import { Router } from "express"
import {
  updateDriverLocation, getDriverLocation,
  getShipmentTracking, addTrackingEvent,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

// Public tracking
router.get("/shipments/:trackingNumber", getShipmentTracking)

router.use(authenticate)

// Driver location
router.post("/driver/location", authorizeRoles("DRIVER"), updateDriverLocation)
router.get("/driver/:driverId", getDriverLocation)

// Tracking events
router.post("/shipments/:shipmentId/events", addTrackingEvent)

export default router
