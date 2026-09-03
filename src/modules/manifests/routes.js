import { Router } from "express"
import { listManifests, createManifest, updateManifestStatus } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listManifests)
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), createManifest)
router.patch("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), updateManifestStatus)

export default router
