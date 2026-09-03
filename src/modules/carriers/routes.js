import { Router } from "express"
import { listCarriers, createCarrier, getCarrier } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listCarriers)
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createCarrier)
router.get("/:id", getCarrier)

export default router
