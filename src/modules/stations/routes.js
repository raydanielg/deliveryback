import { Router } from "express"
import {
  listStations, getStation, createStation, updateStation,
  deleteStation, toggleStation, getStationInventory,
  receiveShipment, dispatchInventory, getStationStats,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listStations)
router.get("/stats", getStationStats)
router.get("/:id", getStation)
router.get("/:id/inventory", getStationInventory)

router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createStation)
router.post("/:id/receive", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), receiveShipment)
router.post("/:id/dispatch", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), dispatchInventory)

router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateStation)
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteStation)
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleStation)

export default router
