import { Router } from "express"
import { resolveScan } from "./controller.js"
import { authenticate } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)
router.get("/resolve/:code", resolveScan)

export default router
