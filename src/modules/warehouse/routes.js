import { Router } from "express"
import {
  listWarehouseShipments, receiveAtWarehouse, verifyAndWeigh,
  generateLabel, assignShelfBin, consolidateByRoute, releaseShipment,
  getWarehouseStats,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

const WAREHOUSE_STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "WAREHOUSE_MANAGER"]

router.get("/", authorizeRoles(...WAREHOUSE_STAFF), listWarehouseShipments)
router.get("/stats", authorizeRoles(...WAREHOUSE_STAFF), getWarehouseStats)

router.post("/:id/receive", authorizeRoles(...WAREHOUSE_STAFF), receiveAtWarehouse)
router.post("/verify-weigh", authorizeRoles(...WAREHOUSE_STAFF), verifyAndWeigh)
router.post("/:id/generate-label", authorizeRoles(...WAREHOUSE_STAFF), generateLabel)
router.post("/assign-shelf-bin", authorizeRoles(...WAREHOUSE_STAFF), assignShelfBin)
router.post("/consolidate", authorizeRoles(...WAREHOUSE_STAFF), consolidateByRoute)
router.post("/release", authorizeRoles(...WAREHOUSE_STAFF), releaseShipment)

export default router
