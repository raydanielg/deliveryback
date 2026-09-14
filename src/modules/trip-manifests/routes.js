import { Router } from "express"
import {
  listTrips, getTrip, createTrip, pairBox, unpairBox, updateTripStatus,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()
const STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"]

router.use(authenticate)

router.get("/", authorizeRoles(...STAFF), listTrips)
router.get("/:id", authorizeRoles(...STAFF), getTrip)
router.post("/", authorizeRoles(...STAFF), createTrip)
router.post("/:id/boxes", authorizeRoles(...STAFF), pairBox)
router.delete("/:id/boxes/:boxId", authorizeRoles(...STAFF), unpairBox)
router.patch("/:id/status", authorizeRoles(...STAFF), updateTripStatus)

export default router
