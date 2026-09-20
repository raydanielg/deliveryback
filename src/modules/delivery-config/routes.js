import { Router } from "express"
import {
  getDeliveryOptions, listZones, createZone, updateZone, deleteZone, getStorageSettings, updateStorageSettings,
} from "./controller.js"
import { flagOldStock } from "../../jobs/old-stock.js"
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
// Manual trigger for the nightly old-stock flag (also runs automatically every 24h).
router.post("/jobs/flag-old-stock", authorizeRoles(...ADMIN), async (req, res, next) => {
  try {
    const result = await flagOldStock()
    res.json({ success: true, data: result, message: `${result.flagged} shipment(s) flagged as old stock` })
  } catch (err) { next(err) }
})


export default router
