import { Router } from "express"
import {
  listPricingRules, createPricingRule, updatePricingRule,
  deletePricingRule, togglePricingRule,
  listSurcharges, createSurcharge, deleteSurcharge,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/rules", listPricingRules)
router.post("/rules", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createPricingRule)
router.put("/rules/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updatePricingRule)
router.delete("/rules/:id", authorizeRoles("SUPER_ADMIN"), deletePricingRule)
router.patch("/rules/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), togglePricingRule)

router.get("/surcharges", listSurcharges)
router.post("/surcharges", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createSurcharge)
router.delete("/surcharges/:id", authorizeRoles("SUPER_ADMIN"), deleteSurcharge)

export default router
