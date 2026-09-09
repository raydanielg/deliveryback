import { Router } from "express"
import {
  listDrivers, getDriver, createDriver, updateDriver, updateDriverStatus, updateDriverApproval,
  listDriverDocuments, addDriverDocument, verifyDriverDocument,
  getDriverCompliance, fleetDriverComplianceReport, getDriverPerformance,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// listDrivers is fleet-roster enumeration — no customer-app usage exists, so staff-only.
// getDriver already redacts internalNotes/emergency contacts/documents for non-staff
// (scopeDriverFields in the controller), so it's left open to any authenticated user.
router.get("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), listDrivers)
router.get("/compliance-report", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), fleetDriverComplianceReport)
router.get("/:id", getDriver)
router.get("/:id/compliance", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), getDriverCompliance)
router.get("/:id/performance", getDriverPerformance)

router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createDriver)
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateDriver)
router.patch("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), updateDriverStatus)
router.patch("/:id/approval", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateDriverApproval)

router.get("/:id/documents", listDriverDocuments)
router.post("/:id/documents", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), addDriverDocument)
router.patch("/documents/:documentId/verify", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), verifyDriverDocument)

export default router
