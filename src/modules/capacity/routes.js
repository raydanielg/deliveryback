import { Router } from "express"
import {
  getCapacityOverview, getManifestCapacity, checkCapacityAlerts, getStationCapacity,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/overview", getCapacityOverview)
router.get("/alerts", checkCapacityAlerts)
router.get("/stations", getStationCapacity)
router.get("/manifests/:id", getManifestCapacity)

export default router
