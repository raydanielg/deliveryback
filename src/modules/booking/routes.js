import { Router } from "express"
import {
  recommendMode, createBooking, bulkBooking, getCargoTypes,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/cargo-types", getCargoTypes)
router.post("/recommend", recommendMode)
router.post("/create", createBooking)
router.post("/bulk", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER"), bulkBooking)

export default router
