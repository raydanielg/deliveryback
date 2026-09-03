import { Router } from "express"
import {
  listSurgePricings, createSurgePricing, updateSurgePricing,
  deleteSurgePricing, toggleSurgePricing,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listSurgePricings)
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createSurgePricing)
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateSurgePricing)
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteSurgePricing)
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleSurgePricing)

export default router
