import { Router } from "express"
import { listApprovals, getApproval, requestApproval, approveApproval, rejectApproval } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()
// Warehouse staff can see the queue (they need to know why a release is blocked) and
// request an approval; only Finance/Operations/Super Admin can actually approve/reject.
const VIEW_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "FINANCE", "WAREHOUSE_MANAGER"]
const APPROVE_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "FINANCE"]

router.use(authenticate)

router.get("/", authorizeRoles(...VIEW_ROLES), listApprovals)
router.get("/:id", authorizeRoles(...VIEW_ROLES), getApproval)
router.post("/", authorizeRoles(...VIEW_ROLES), requestApproval)
router.post("/:id/approve", authorizeRoles(...APPROVE_ROLES), approveApproval)
router.post("/:id/reject", authorizeRoles(...APPROVE_ROLES), rejectApproval)

export default router
