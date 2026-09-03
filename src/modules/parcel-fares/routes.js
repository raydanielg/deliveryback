import { Router } from "express"
import {
  listParcelFares, createParcelFare, updateParcelFare, deleteParcelFare,
  listParcelFareWeights, createParcelFareWeight, updateParcelFareWeight, deleteParcelFareWeight,
  estimateParcelFare,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// Fare estimation (available to all authenticated users)
router.get("/estimate", estimateParcelFare)

// Parcel fares CRUD
router.get("/fares", listParcelFares)
router.post("/fares", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createParcelFare)
router.put("/fares/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateParcelFare)
router.delete("/fares/:id", authorizeRoles("SUPER_ADMIN"), deleteParcelFare)

// Parcel fare weights CRUD
router.get("/fare-weights", listParcelFareWeights)
router.post("/fare-weights", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createParcelFareWeight)
router.put("/fare-weights/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateParcelFareWeight)
router.delete("/fare-weights/:id", authorizeRoles("SUPER_ADMIN"), deleteParcelFareWeight)

export default router
