import { Router } from "express"
import { listNotifications, markAsRead, markAllAsRead } from "./controller.js"
import { authenticate } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listNotifications)
router.patch("/:id/read", markAsRead)
router.patch("/read-all", markAllAsRead)

export default router
