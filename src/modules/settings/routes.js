import { Router } from "express"
import { getMapSettings, updateMapSettings, getPublicMapSettings } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

// Public endpoint for mobile customer & driver app to fetch tile server & theme
router.get("/public-map", getPublicMapSettings)

// Admin protected endpoints
router.get("/map", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"]), getMapSettings)
router.put("/map", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER"]), updateMapSettings)

export default router
