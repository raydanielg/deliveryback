import { Router } from "express"
import {
  createAirCargoBooking, listAirCargoShipments, getAirCargoShipment,
  acceptCargo, createFlightDispatch, arriveAtAirport, getAirCargoStats,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listAirCargoShipments)
router.get("/stats", getAirCargoStats)
router.get("/:id", getAirCargoShipment)

router.post("/booking", createAirCargoBooking)
router.post("/:id/accept", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"), acceptCargo)
router.post("/flight-dispatch", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), createFlightDispatch)
router.post("/manifests/:id/arrive", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), arriveAtAirport)

export default router
