import { Router } from "express"
import {
  createConnection,
  getQRCode,
  listConnections,
  getConnection,
  reconnect,
  disconnect,
  toggleConnection,
  sendMessage,
  sendTestMessageController,
  listMessages,
  getShipmentMessages,
  requestOTP,
  verifyOTPController,
  listTemplatesController,
  createTemplateController,
  updateTemplateController,
  listCampaigns,
  createCampaignController,
  startCampaignController,
  pauseCampaignController,
  resumeCampaignController,
  cancelCampaignController,
  getCampaignAnalyticsController,
  getDashboard,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

const WHATSAPP_STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "CUSTOMER_SUPPORT"]

// Dashboard
router.get("/dashboard", getDashboard)

// Connections
router.get("/connections", listConnections)
router.post("/connections", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createConnection)
router.get("/connections/:id", getConnection)
// QR pairing data — leaking this lets anyone hijack the linked WhatsApp Business session.
router.get("/connections/:id/qr", authorizeRoles(...WHATSAPP_STAFF), getQRCode)
router.post("/connections/:id/reconnect", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), reconnect)
router.post("/connections/:id/disconnect", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), disconnect)
router.patch("/connections/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleConnection)

// Messaging
router.post("/send", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), sendMessage)
router.post("/send-test", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), sendTestMessageController)
// Message log — every customer's phone number + message body/template, system-wide.
// Previously had no role check at all.
router.get("/messages", authorizeRoles(...WHATSAPP_STAFF), listMessages)
router.get("/messages/shipment/:id", authorizeRoles(...WHATSAPP_STAFF), getShipmentMessages)

// OTP
router.post("/otp/request", requestOTP)
router.post("/otp/verify", verifyOTPController)

// Templates
router.get("/templates", listTemplatesController)
router.post("/templates", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createTemplateController)
router.patch("/templates/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateTemplateController)

// Campaigns
router.get("/campaigns", listCampaigns)
router.post("/campaigns", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING"), createCampaignController)
router.post("/campaigns/:id/start", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING"), startCampaignController)
router.post("/campaigns/:id/pause", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING"), pauseCampaignController)
router.post("/campaigns/:id/resume", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING"), resumeCampaignController)
router.post("/campaigns/:id/cancel", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING"), cancelCampaignController)
router.get("/campaigns/:id/analytics", getCampaignAnalyticsController)

export default router
