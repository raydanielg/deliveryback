import { Router } from "express"
import { getWaybill } from "./controller.js"
import { authenticate } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/:shipmentId", getWaybill)

export default router
