import { Router } from "express"
import {
  listExceptions, getException, createException, updateException,
  createReturn, resolveException, escalateException, getExceptionStats,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listExceptions)
router.get("/stats", getExceptionStats)
router.get("/:id", getException)

router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), createException)
router.post("/return", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), createReturn)

router.patch("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateException)
router.patch("/:id/resolve", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), resolveException)
router.patch("/:id/escalate", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), escalateException)

export default router
