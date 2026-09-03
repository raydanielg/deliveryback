import { Router } from "express"
import { listPayments, createPayment, getPayment } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listPayments)
router.post("/", createPayment)
router.get("/:id", getPayment)

export default router
