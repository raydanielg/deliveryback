import { Router } from "express"
import {
  listTrips,
  getTrip,
  getMyTrips,
  getMyActiveTrip,
  acceptTrip,
  arriveAtPickup,
  verifyCargo,
  pickupTrip,
  startTransit,
  arriveAtDestination,
  deliverTrip,
  capturePod,
  completeTrip,
  raiseException,
  resolveException,
  getTripOverview,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"
import { driverAuth } from "../../middleware/driver-auth.js"

const router = Router()

// ============================================================
// CONTROL TOWER ENDPOINTS (admin/dispatcher)
// ============================================================
router.use(authenticate)

router.get("/overview", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), getTripOverview)
router.get("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), listTrips)
router.get("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), getTrip)
router.post("/:id/complete", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), completeTrip)
router.post("/:id/resolve-exception", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), resolveException)

// ============================================================
// DRIVER APP ENDPOINTS (driver-auth required)
// ============================================================
router.get("/my-trips", driverAuth, getMyTrips)
router.get("/my-active-trip", driverAuth, getMyActiveTrip)
router.post("/:id/accept", driverAuth, acceptTrip)
router.post("/:id/arrive-pickup", driverAuth, arriveAtPickup)
router.post("/:id/verify-cargo", driverAuth, verifyCargo)
router.post("/:id/pickup", driverAuth, pickupTrip)
router.post("/:id/start-transit", driverAuth, startTransit)
router.post("/:id/arrive-destination", driverAuth, arriveAtDestination)
router.post("/:id/deliver", driverAuth, deliverTrip)
router.post("/:id/pod", driverAuth, capturePod)
router.post("/:id/exception", driverAuth, raiseException)

export default router
