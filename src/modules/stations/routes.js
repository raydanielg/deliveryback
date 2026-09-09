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
// These two embed sender/recipient full name/phone/city for every shipment in station
// inventory — previously had no role check at all. listStations/getStationStats above
// only return station metadata/counts, so they're left open to any authenticated user.
const STATION_STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "SGR_STATION_OFFICER", "WAREHOUSE_MANAGER"]
router.get("/:id", authorizeRoles(...STATION_STAFF), getStation)
router.get("/:id/inventory", authorizeRoles(...STATION_STAFF), getStationInventory)

router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createStation)
router.post("/:id/receive", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), receiveShipment)
router.post("/:id/dispatch", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), dispatchInventory)

router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateStation)
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteStation)
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleStation)

export default router
