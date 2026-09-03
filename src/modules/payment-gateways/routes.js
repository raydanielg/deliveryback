import { Router } from "express"
import {
  listPaymentGateways, getPaymentGateway, createPaymentGateway,
  updatePaymentGateway, deletePaymentGateway, togglePaymentGateway,
  initiatePayment, selcomWebhook, azampesaCallback, getActiveGateways,
  getSelcomOrderStatus, cancelSelcomOrder,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

// Public webhook routes (no auth - called by payment providers)
router.post("/webhooks/selcom", selcomWebhook)
router.post("/callbacks/azampesa", azampesaCallback)

// Get active gateways (for customer app - light auth)
router.get("/active", authenticate, getActiveGateways)

// Authenticated routes
router.use(authenticate)

// Initiate payment (all authenticated users)
router.post("/initiate", initiatePayment)

// Selcom order status & cancel (all authenticated users)
router.get("/selcom/order-status", getSelcomOrderStatus)
router.delete("/selcom/cancel-order", cancelSelcomOrder)

// Gateway CRUD (admin only)
router.get("/", authorizeRoles("SUPER_ADMIN", "FINANCE"), listPaymentGateways)
router.get("/:id", authorizeRoles("SUPER_ADMIN", "FINANCE"), getPaymentGateway)
router.post("/", authorizeRoles("SUPER_ADMIN", "FINANCE"), createPaymentGateway)
router.put("/:id", authorizeRoles("SUPER_ADMIN", "FINANCE"), updatePaymentGateway)
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deletePaymentGateway)
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "FINANCE"), togglePaymentGateway)

export default router
