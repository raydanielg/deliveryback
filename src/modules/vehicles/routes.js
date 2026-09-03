import { Router } from "express"
import { listVehicles, createVehicle, updateVehicleStatus } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listVehicles)
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createVehicle)
router.patch("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateVehicleStatus)

export default router
