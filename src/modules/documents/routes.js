import { Router } from "express"
import { listDocuments, uploadDocument, verifyDocument, deleteDocument } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listDocuments)
router.post("/", uploadDocument)
router.put("/:id/verify", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMS_OFFICER", "CUSTOMER_SUPPORT"), verifyDocument)
router.delete("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), deleteDocument)

export default router
