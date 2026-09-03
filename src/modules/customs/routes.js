import { Router } from "express"
import { getCustomsDeclaration, createCustomsDeclaration, updateCustomsStatus } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/:shipmentId", getCustomsDeclaration)
router.post("/", createCustomsDeclaration)
router.put("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMS_OFFICER"), updateCustomsStatus)

export default router
