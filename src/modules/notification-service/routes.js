import { Router } from "express"
import { listNotificationLogs, getNotificationStats, sendBulkNotification } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/logs", listNotificationLogs)
router.get("/stats", getNotificationStats)
router.post("/bulk", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), sendBulkNotification)

export default router
