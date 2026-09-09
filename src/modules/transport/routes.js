import { Router } from "express"
import {
  getOrCreateTransportRequest,
  listTransportRequests,
  getCapacityMatches,
  publishCapacity,
  listCapacity,
  updateCapacity,
  cancelCapacity,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// Transport requests
router.get("/requests", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), listTransportRequests)
router.get("/requests/:shipmentId", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), getOrCreateTransportRequest)
router.get("/requests/:id/capacity-matches", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), getCapacityMatches)

// Transport capacity (partner marketplace)
router.get("/capacity", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "FINANCE"), listCapacity)
router.post("/capacity", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), publishCapacity)
router.patch("/capacity/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), updateCapacity)
router.delete("/capacity/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), cancelCapacity)

export default router
