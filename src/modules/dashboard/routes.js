import { Router } from "express"
import { getFinanceDashboard, getWarehouseDashboard, getOperationsDashboard } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// Each staff role gets its own dashboard feed. Super Admin / Operations (IT) may read all
// three (authorizeRoles admits OPERATIONS_MANAGER wherever SUPER_ADMIN is listed).
router.get("/finance", authorizeRoles("SUPER_ADMIN", "FINANCE"), getFinanceDashboard)
router.get("/warehouse", authorizeRoles("SUPER_ADMIN", "WAREHOUSE_MANAGER"), getWarehouseDashboard)
router.get("/operations", authorizeRoles("SUPER_ADMIN"), getOperationsDashboard)

export default router
