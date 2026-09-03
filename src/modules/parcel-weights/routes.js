import { Router } from "express"
import {
  listParcelWeights, createParcelWeight, updateParcelWeight,
  deleteParcelWeight, toggleParcelWeight,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listParcelWeights)
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createParcelWeight)
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateParcelWeight)
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteParcelWeight)
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleParcelWeight)

export default router
