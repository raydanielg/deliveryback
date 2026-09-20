import { Router } from "express"
import {
  listDeliveries,
  myDeliveries,
  getDelivery,
  createDelivery,
  markOutForDelivery,
  completeDelivery,
  failDelivery,
  approveFeeOverride,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

// Spec §4.2 — Delivery Register: Dispatch + Driver operate; warehouse/finance view.
const VIEW_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "WAREHOUSE_MANAGER", "FINANCE"]
const OPERATE_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER"]
const DRIVER_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DRIVER"]
const MANAGER_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER"]

router.use(authenticate)

router.get("/", authorizeRoles(...VIEW_ROLES, "DRIVER"), listDeliveries)
router.get("/my", authorizeRoles("DRIVER"), myDeliveries)
router.get("/:id", authorizeRoles(...VIEW_ROLES, "DRIVER"), getDelivery)
router.post("/", authorizeRoles(...OPERATE_ROLES), createDelivery)
router.post("/:id/out-for-delivery", authorizeRoles(...OPERATE_ROLES), markOutForDelivery)
router.post("/:id/complete", authorizeRoles(...DRIVER_ROLES), completeDelivery)
router.post("/:id/fail", authorizeRoles(...DRIVER_ROLES), failDelivery)
router.post("/:id/fee-approval", authorizeRoles(...MANAGER_ROLES), approveFeeOverride)

export default router
