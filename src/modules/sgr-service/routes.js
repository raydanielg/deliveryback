import { Router } from "express"
import {
  createSGRBooking, listSGRShipments, getSGRShipment,
  verifyAndWeigh, consolidateShipments, loadOnTrain,
  arriveAtDestination, getSGRStats,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listSGRShipments)
router.get("/stats", getSGRStats)
router.get("/:id", getSGRShipment)

router.post("/booking", createSGRBooking)
router.post("/:id/verify-weigh", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"), verifyAndWeigh)
router.post("/consolidate", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), consolidateShipments)
router.post("/load-on-train", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), loadOnTrain)
router.post("/manifests/:id/arrive", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), arriveAtDestination)

export default router
