import { Router } from "express"
import { listOrders, getOrder, getOrderStats } from "./controller.js"
import { authenticate } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listOrders)
router.get("/stats", getOrderStats)
router.get("/:id", getOrder)

export default router
