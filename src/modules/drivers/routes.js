import { Router } from "express"
import { listDrivers, createDriver, updateDriverStatus } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listDrivers)
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createDriver)
router.patch("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), updateDriverStatus)

export default router
