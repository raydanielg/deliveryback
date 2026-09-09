import { Router } from "express"
import {
  createAirCargoBooking, listAirCargoShipments, getAirCargoShipment,
  acceptCargo, createFlightDispatch, arriveAtAirport, getAirCargoStats,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// Staff-only — same reasoning as sgr-service: this queries the same Shipment table as
// the already-fixed shipments.getShipment and, unguarded, let any authenticated customer
// bypass that fix by calling /air-cargo/:id instead, exposing order/customsDeclaration/
// documents/packages for any AIR shipment.
const AIR_CARGO_STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER", "CUSTOMER_SUPPORT", "CUSTOMS_OFFICER"]
router.get("/", authorizeRoles(...AIR_CARGO_STAFF), listAirCargoShipments)
router.get("/stats", authorizeRoles(...AIR_CARGO_STAFF), getAirCargoStats)
router.get("/:id", authorizeRoles(...AIR_CARGO_STAFF), getAirCargoShipment)

router.post("/booking", createAirCargoBooking)
router.post("/:id/accept", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"), acceptCargo)
router.post("/flight-dispatch", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), createFlightDispatch)
router.post("/manifests/:id/arrive", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), arriveAtAirport)

export default router
