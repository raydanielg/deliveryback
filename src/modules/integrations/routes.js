import { Router } from "express"
import {
  listPartners, getPartner, createPartner, updatePartner, setPartnerStatus, deletePartner,
  testWebhook, listPartnerLogs, listPartnerWebhookDeliveries, retryWebhookDelivery,
  integrationsDashboard, listApiKeys, createApiKey, revokeApiKey,
} from "./partners-controller.js"
import { receiveInboundWebhook } from "./inbound-controller.js"
import {
  createPartnerShipment, getPartnerShipment, listPartnerShipments,
  getPartnerShipmentTracking, getPartnerShipmentPod, cancelPartnerShipment,
} from "./api-controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"
import { authenticatePartner, requireScope } from "../../middleware/partner-auth.js"
import { publicEndpointLimiter, partnerApiLimiter } from "../../middleware/rate-limit.js"

const router = Router()

const ADMIN_ROLES = ["SUPER_ADMIN"]
const VIEW_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "REPORT_VIEWER"]

// ============================================================
// Inbound: a partner pushing events INTO Xerin. Public route — authenticated by HMAC
// signature (see inbound-controller.js), not a session/API key, since the caller is the
// partner's own server, not a browser or our mobile app.
// ============================================================
router.post("/webhooks/:partnerSlug", publicEndpointLimiter, receiveInboundWebhook)

// ============================================================
// Outbound partner-facing API (Part H) — a partner's own server calling Xerin, authenticated
// by their API key, scoped and rate-limited per partner, never by staff session.
// ============================================================
router.post("/shipments", authenticatePartner, partnerApiLimiter, requireScope("shipments.create"), createPartnerShipment)
router.get("/shipments", authenticatePartner, partnerApiLimiter, requireScope("shipments.read"), listPartnerShipments)
router.get("/shipments/:id", authenticatePartner, partnerApiLimiter, requireScope("shipments.read"), getPartnerShipment)
router.get("/shipments/:id/tracking", authenticatePartner, partnerApiLimiter, requireScope("tracking.read"), getPartnerShipmentTracking)
router.get("/shipments/:id/pod", authenticatePartner, partnerApiLimiter, requireScope("pod.read"), getPartnerShipmentPod)
router.post("/shipments/:id/cancel", authenticatePartner, partnerApiLimiter, requireScope("shipments.cancel"), cancelPartnerShipment)

// ============================================================
// Admin: managing partner integrations themselves (Part K/W) — staff-only, JWT session auth.
// ============================================================
router.use("/partners", authenticate)

router.get("/partners/dashboard", authorizeRoles(...VIEW_ROLES), integrationsDashboard)
router.get("/partners", authorizeRoles(...VIEW_ROLES), listPartners)
router.get("/partners/:id", authorizeRoles(...VIEW_ROLES), getPartner)
router.post("/partners", authorizeRoles(...ADMIN_ROLES), createPartner)
router.put("/partners/:id", authorizeRoles(...ADMIN_ROLES), updatePartner)
router.patch("/partners/:id/status", authorizeRoles(...ADMIN_ROLES), setPartnerStatus)
router.delete("/partners/:id", authorizeRoles(...ADMIN_ROLES), deletePartner)
router.post("/partners/:id/test-webhook", authorizeRoles(...ADMIN_ROLES), testWebhook)
router.get("/partners/:id/logs", authorizeRoles(...VIEW_ROLES), listPartnerLogs)
router.get("/partners/:id/webhook-deliveries", authorizeRoles(...VIEW_ROLES), listPartnerWebhookDeliveries)
router.post("/webhook-deliveries/:deliveryId/retry", authenticate, authorizeRoles(...ADMIN_ROLES), retryWebhookDelivery)

router.get("/partners/:id/api-keys", authorizeRoles(...ADMIN_ROLES), listApiKeys)
router.post("/partners/:id/api-keys", authorizeRoles(...ADMIN_ROLES), createApiKey)
router.delete("/api-keys/:keyId", authenticate, authorizeRoles(...ADMIN_ROLES), revokeApiKey)

export default router
