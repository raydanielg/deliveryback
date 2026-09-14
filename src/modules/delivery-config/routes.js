import { Router } from "express"
import {
  getDeliveryOptions, listZones, createZone, updateZone, deleteZone, getStorageSettings, updateStorageSettings,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()
const ADMIN = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "FINANCE"]

router.use(authenticate)

router.get("/options", getDeliveryOptions)
router.get("/zones", listZones)
router.get("/storage-settings", getStorageSettings)

router.post("/zones", authorizeRoles(...ADMIN), createZone)
router.put("/zones/:id", authorizeRoles(...ADMIN), updateZone)
router.delete("/zones/:id", authorizeRoles(...ADMIN), deleteZone)
router.put("/storage-settings", authorizeRoles(...ADMIN), updateStorageSettings)

export default router
