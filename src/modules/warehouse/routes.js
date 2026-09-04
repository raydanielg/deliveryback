import { Router } from "express"
import {
  listWarehouseShipments, receiveAtWarehouse, verifyAndWeigh,
  generateLabel, assignShelfBin, consolidateByRoute, releaseShipment,
  getWarehouseStats,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listWarehouseShipments)
router.get("/stats", getWarehouseStats)

router.post("/:id/receive", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"), receiveAtWarehouse)
router.post("/verify-weigh", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"), verifyAndWeigh)
router.post("/:id/generate-label", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"), generateLabel)
router.post("/assign-shelf-bin", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"), assignShelfBin)
router.post("/consolidate", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"), consolidateByRoute)
router.post("/release", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"), releaseShipment)

export default router
