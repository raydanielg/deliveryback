import { Router } from "express"
import {
  getOverviewReport, getModeReport, getRevenueReport,
  getTopRoutesReport, getExceptionReport, getWarehouseReport,
  getSGRReport, getAirCargoReport,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/overview", getOverviewReport)
router.get("/by-mode", getModeReport)
router.get("/revenue", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "FINANCE", "REPORT_VIEWER"), getRevenueReport)
router.get("/top-routes", getTopRoutesReport)
router.get("/exceptions", getExceptionReport)
router.get("/warehouse", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "WAREHOUSE_MANAGER", "REPORT_VIEWER"), getWarehouseReport)
router.get("/sgr", getSGRReport)
router.get("/air-cargo", getAirCargoReport)

export default router
