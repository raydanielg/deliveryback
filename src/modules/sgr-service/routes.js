import { Router } from "express"
import {
  createSGRBooking, listSGRShipments, getSGRShipment,
  verifyAndWeigh, consolidateShipments, loadOnTrain,
  arriveAtDestination, getSGRStats,
  startFirstMile, receiveCargo, beginScreening, finishScreening,
  allocateToTrain, loadCargo, departTrainController, arriveTrainController,
  startLastMile, collectCargo, raiseException, getControlTower,
  getShipmentPackages, getSGRPricing, addSGRPricing, getSGRQuote,
  getShipmentLegs,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// Control tower
router.get("/control-tower", getControlTower)
router.get("/stats", getSGRStats)

// Pricing
router.get("/pricing", getSGRPricing)
router.post("/pricing", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), addSGRPricing)
router.post("/quote", getSGRQuote)

// Shipment listing — station/control-tower views, staff-only. A customer looks up their
// own shipment via /shipments/:id or the public /track endpoint (both already ownership-
// scoped); these routes previously had no guard at all and, since they query the same
// Shipment table as the already-fixed shipments.getShipment, let any authenticated
// customer bypass that fix and pull full order/station-inventory/manifest/package detail
// for any RAIL shipment just by hitting /sgr-service/:id instead.
const SGR_STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "SGR_STATION_OFFICER", "WAREHOUSE_MANAGER", "CUSTOMER_SUPPORT"]
router.get("/", authorizeRoles(...SGR_STAFF), listSGRShipments)
router.get("/:id", authorizeRoles(...SGR_STAFF), getSGRShipment)
router.get("/:id/legs", authorizeRoles(...SGR_STAFF), getShipmentLegs)
router.get("/:id/packages", authorizeRoles(...SGR_STAFF), getShipmentPackages)

// Booking
router.post("/booking", createSGRBooking)

// First mile
router.post("/:id/first-mile", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), startFirstMile)

// Station operations
router.post("/:id/receive-cargo", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "SGR_STATION_OFFICER", "WAREHOUSE_MANAGER"), receiveCargo)
router.post("/:id/screening/start", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "SGR_STATION_OFFICER"), beginScreening)
router.post("/:id/screening/complete", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "SGR_STATION_OFFICER"), finishScreening)

// Train assignment + loading
router.post("/:id/assign-train", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "SGR_STATION_OFFICER"), allocateToTrain)
router.post("/:id/load-cargo", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "SGR_STATION_OFFICER"), loadCargo)

// Train departure / arrival (by train capacity ID)
router.post("/trains/:trainCapacityId/depart", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), departTrainController)
router.post("/trains/:trainCapacityId/arrive", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "SGR_STATION_OFFICER"), arriveTrainController)

// Last mile
router.post("/:id/last-mile", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), startLastMile)

// Collection (station-to-station)
router.post("/:id/collect", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "SGR_STATION_OFFICER"), collectCargo)

// Exceptions — previously had no role gate at all, letting any authenticated user log an
// exception against any RAIL shipment.
router.post("/:id/exception", authorizeRoles(...SGR_STAFF), raiseException)

// Legacy endpoints (kept for backward compatibility)
router.post("/:id/verify-weigh", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"), verifyAndWeigh)
router.post("/consolidate", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), consolidateShipments)
router.post("/load-on-train", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), loadOnTrain)
router.post("/manifests/:id/arrive", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), arriveAtDestination)

export default router
