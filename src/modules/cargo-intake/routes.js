import { Router } from "express"
import { receiveTz, listPendingTz } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()
const STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"]

router.use(authenticate)
router.use(authorizeRoles(...STAFF))

router.post("/tz/receive", receiveTz)
router.get("/tz/pending", listPendingTz)

export default router
