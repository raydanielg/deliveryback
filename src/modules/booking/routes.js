import { Router } from "express"
import {
  recommendMode, createBooking, bulkBooking, getCargoTypes,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

// Public — neither getCargoTypes nor recommendMode touch req.user, and a visitor must be
// able to see cargo types and get a transport-mode recommendation before creating an
// account, matching /quotes/calculate and /quotes/multiple being public for the same reason.
router.get("/cargo-types", getCargoTypes)
router.post("/recommend", recommendMode)

router.use(authenticate)

router.post("/create", createBooking)
router.post("/bulk", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER"), bulkBooking)

export default router
