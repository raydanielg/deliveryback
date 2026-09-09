import { Router } from "express"
import { listNotificationLogs, getNotificationStats, sendBulkNotification } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// SMS/email delivery logs across every user — previously had no role check at all.
router.get("/logs", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"), listNotificationLogs)
router.get("/stats", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"), getNotificationStats)
router.post("/bulk", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), sendBulkNotification)

export default router
