import { Router } from "express"
import {
  listVehicles, getVehicle, createVehicle, updateVehicle, updateVehicleStatus,
  listMaintenanceRecords, createMaintenanceRecord, updateMaintenanceRecord,
  fleetComplianceReport,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// Internal fleet roster — no customer-app usage exists.
router.get("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), listVehicles)
router.get("/compliance-report", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), fleetComplianceReport)
router.get("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), getVehicle)
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createVehicle)
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateVehicle)
router.patch("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateVehicleStatus)

router.get("/:id/maintenance", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), listMaintenanceRecords)
router.post("/:id/maintenance", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createMaintenanceRecord)
router.put("/maintenance/:recordId", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateMaintenanceRecord)

export default router
