import { Router } from "express"
import {
  listParcelCategories, getParcelCategory, createParcelCategory,
  updateParcelCategory, deleteParcelCategory, toggleParcelCategory,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listParcelCategories)
router.get("/:id", getParcelCategory)
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createParcelCategory)
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateParcelCategory)
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteParcelCategory)
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleParcelCategory)

export default router
