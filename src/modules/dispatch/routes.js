import { Router } from "express"
import {
  openToDrivers,
  acceptOrder,
  rejectOrder,
  getAvailableOrders,
  goOnline,
  goOffline,
  autoAssign,
  cancelOffers,
  getDispatchOverview,
  getEligibleDriversForShipment,
  reassignShipment,
  getAssignmentHistory,
  getDispatchAnalytics,
  getDispatchConfig,
  updateDispatchConfig,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"
import { driverAuth } from "../../middleware/driver-auth.js"

const router = Router()

// ============================================================
// DISPATCH CONTROL TOWER (admin/dispatcher endpoints)
// ============================================================
router.use(authenticate)

// Get dispatch overview (control tower dashboard)
router.get("/overview", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), getDispatchOverview)

// Get dispatch analytics
router.get("/analytics", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), getDispatchAnalytics)

// Get dispatch config
router.get("/config", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), (req, res) => {
  res.json({ success: true, data: getDispatchConfig() })
})

// Update dispatch config
router.put("/config", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), (req, res, next) => {
  try {
    const updated = updateDispatchConfig(req.body)
    res.json({ success: true, message: "Dispatch configuration updated", data: updated })
  } catch (err) { next(err) }
})

// Get eligible drivers for a shipment (dispatcher view)
router.get("/shipments/:id/eligible-drivers", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), getEligibleDriversForShipment)

// Open shipment to driver marketplace
router.post("/shipments/:id/open-to-drivers", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), openToDrivers)

// Auto-assign best driver
router.post("/shipments/:id/auto-assign", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), autoAssign)

// Cancel all pending offers for a shipment
router.post("/shipments/:id/cancel-offers", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), cancelOffers)

// Reassign shipment to a new driver
router.put("/shipments/:id/reassign", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), reassignShipment)

// Get assignment history for a shipment
router.get("/shipments/:id/assignments", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), getAssignmentHistory)

// ============================================================
// DRIVER APP ENDPOINTS (driver-auth required)
// ============================================================

// Get available orders for driver
router.get("/available-orders", driverAuth, getAvailableOrders)

// Driver accepts an order
router.post("/offers/:offerId/accept", driverAuth, acceptOrder)

// Driver rejects an order
router.post("/offers/:offerId/reject", driverAuth, rejectOrder)

// Driver go online
router.post("/go-online", driverAuth, goOnline)

// Driver go offline
router.post("/go-offline", driverAuth, goOffline)

export default router
