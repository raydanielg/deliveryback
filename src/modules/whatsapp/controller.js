import prisma from "../../prisma/client.js"
import {
  startConnection,
  restoreConnection,
  restoreAllConnections,
  disconnectConnection,
  reconnectConnection,
  healthCheck,
  heartbeatMonitor,
  getConnectionStats,
} from "./connection-manager.js"
import { queueMessage, sendTestMessage, triggerEventNotification, processAllQueues } from "./messaging-service.js"
import { sendOTP, verifyOTP, cleanupExpiredOTPs } from "./otp-engine.js"
import {
  createTemplate,
  updateTemplate,
  listTemplates,
  seedDefaultTemplates,
} from "./template-engine.js"
import {
  createCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  getCampaignAnalytics,
  processScheduledCampaigns,
} from "./campaign-engine.js"

// ============================================================
// WHATSAPP ENGINE CONTROLLER
// ============================================================

// ---------------------------------------------------------
// CONNECTIONS
// ---------------------------------------------------------

export async function createConnection(req, res, next) {
  try {
    const { name, provider, purpose } = req.body
    if (!name) return res.status(400).json({ success: false, message: "Connection name is required" })

    const connectionId = `wa_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    const result = await startConnection(connectionId, name, req.user.id)

    // Update purpose if provided
    if (purpose) {
      await prisma.whatsAppConnection.update({
        where: { id: connectionId },
        data: { purpose, provider: provider || "baileys" },
      })
    }

    res.status(201).json({ success: true, data: { connectionId, ...result } })
  } catch (err) { next(err) }
}

export async function getQRCode(req, res, next) {
  try {
    const { id } = req.params
    const conn = await prisma.whatsAppConnection.findUnique({ where: { id } })
    if (!conn) return res.status(404).json({ success: false, message: "Connection not found" })

    if (conn.status === "CONNECTED") {
      return res.json({ success: true, data: { status: "CONNECTED", qrCode: null, message: "Already connected" } })
    }

    if (!conn.qrCode) {
      // Try to generate new QR
      await reconnectConnection(id)
      const updated = await prisma.whatsAppConnection.findUnique({ where: { id } })
      return res.json({ success: true, data: { status: updated.status, qrCode: updated.qrCode } })
    }

    res.json({ success: true, data: { status: conn.status, qrCode: conn.qrCode } })
  } catch (err) { next(err) }
}

export async function listConnections(req, res, next) {
  try {
    const stats = await getConnectionStats()
    res.json({ success: true, data: stats })
  } catch (err) { next(err) }
}

export async function getConnection(req, res, next) {
  try {
    const { id } = req.params
    const health = await healthCheck(id)
    res.json({ success: true, data: health })
  } catch (err) { next(err) }
}

export async function reconnect(req, res, next) {
  try {
    const { id } = req.params
    const result = await reconnectConnection(id)
    res.json({ success: true, data: result, message: "Reconnection initiated" })
  } catch (err) { next(err) }
}

export async function disconnect(req, res, next) {
  try {
    const { id } = req.params
    const { destroy } = req.body
    await disconnectConnection(id, destroy)
    res.json({ success: true, message: destroy ? "Disconnected and session destroyed" : "Disconnected" })
  } catch (err) { next(err) }
}

export async function toggleConnection(req, res, next) {
  try {
    const { id } = req.params
    const { isActive } = req.body
    await prisma.whatsAppConnection.update({
      where: { id },
      data: { isActive, status: isActive ? "DISCONNECTED" : "DISABLED" },
    })
    res.json({ success: true, message: `Connection ${isActive ? "enabled" : "disabled"}` })
  } catch (err) { next(err) }
}

// ---------------------------------------------------------
// MESSAGING
// ---------------------------------------------------------

export async function sendMessage(req, res, next) {
  try {
    const { recipient, templateName, variables, connectionId, eventType, shipmentId, metadata } = req.body

    if (!recipient) return res.status(400).json({ success: false, message: "recipient is required" })
    if (!connectionId && !eventType) return res.status(400).json({ success: false, message: "connectionId or eventType is required" })

    let connId = connectionId
    if (!connId && eventType) {
      const conn = await prisma.whatsAppConnection.findFirst({
        where: { isActive: true, status: "CONNECTED" },
      })
      if (!conn) return res.status(503).json({ success: false, message: "No connected WhatsApp session" })
      connId = conn.id
    }

    const message = await queueMessage({
      connectionId: connId,
      recipient,
      templateName,
      variables: variables || {},
      eventType,
      shipmentId,
      metadata,
    })

    res.status(201).json({ success: true, data: message, message: "Message queued" })
  } catch (err) { next(err) }
}

export async function sendTestMessageController(req, res, next) {
  try {
    const { connectionId, recipient, message } = req.body
    if (!connectionId || !recipient) {
      return res.status(400).json({ success: false, message: "connectionId and recipient are required" })
    }

    const result = await sendTestMessage(connectionId, recipient, message || "XERIN Express test message")
    res.json({ success: true, data: result, message: "Test message queued" })
  } catch (err) { next(err) }
}

export async function listMessages(req, res, next) {
  try {
    const { connectionId, status, page = 1, limit = 50 } = req.query
    const where = {}
    if (connectionId) where.connectionId = connectionId
    if (status) where.status = status

    const messages = await prisma.whatsAppMessage.findMany({
      where,
      include: {
        connection: { select: { name: true } },
        template: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
    })

    const total = await prisma.whatsAppMessage.count({ where })

    res.json({ success: true, data: messages, total })
  } catch (err) { next(err) }
}

export async function getShipmentMessages(req, res, next) {
  try {
    const { id } = req.params
    const messages = await prisma.whatsAppMessage.findMany({
      where: { shipmentId: id },
      include: {
        connection: { select: { name: true } },
        template: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: messages })
  } catch (err) { next(err) }
}

// ---------------------------------------------------------
// OTP
// ---------------------------------------------------------

export async function requestOTP(req, res, next) {
  try {
    const { phone, purpose } = req.body
    if (!phone) return res.status(400).json({ success: false, message: "phone is required" })

    const result = await sendOTP(phone, purpose || "VERIFICATION")
    res.json({ success: true, data: result })
  } catch (err) { next(err) }
}

export async function verifyOTPController(req, res, next) {
  try {
    const { phone, otp, purpose } = req.body
    if (!phone || !otp) return res.status(400).json({ success: false, message: "phone and otp are required" })

    const result = await verifyOTP(phone, otp, purpose || "VERIFICATION")
    if (result.success) {
      res.json({ success: true, data: result })
    } else {
      res.status(400).json({ success: false, message: result.message })
    }
  } catch (err) { next(err) }
}

// ---------------------------------------------------------
// TEMPLATES
// ---------------------------------------------------------

export async function listTemplatesController(req, res, next) {
  try {
    const { category, eventType, active } = req.query
    const templates = await listTemplates({
      category,
      eventType,
      active: active === "true" ? true : active === "false" ? false : undefined,
    })
    res.json({ success: true, data: templates })
  } catch (err) { next(err) }
}

export async function createTemplateController(req, res, next) {
  try {
    const { name, eventType, body, smsBody, category, language } = req.body
    if (!name || !body) return res.status(400).json({ success: false, message: "name and body are required" })

    const template = await createTemplate({
      name,
      eventType,
      body,
      smsBody,
      category,
      language,
      createdBy: req.user.id,
    })
    res.status(201).json({ success: true, data: template, message: "Template created" })
  } catch (err) { next(err) }
}

export async function updateTemplateController(req, res, next) {
  try {
    const { id } = req.params
    const template = await updateTemplate(id, req.body)
    res.json({ success: true, data: template, message: "Template updated" })
  } catch (err) { next(err) }
}

// ---------------------------------------------------------
// CAMPAIGNS
// ---------------------------------------------------------

export async function listCampaigns(req, res, next) {
  try {
    const { status, page = 1, limit = 50 } = req.query
    const where = {}
    if (status) where.status = status

    const campaigns = await prisma.whatsAppCampaign.findMany({
      where,
      include: {
        connection: { select: { name: true, status: true } },
        template: { select: { name: true, body: true } },
        _count: { select: { recipients: true } },
      },
      orderBy: { createdAt: "desc" },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
    })

    res.json({ success: true, data: campaigns })
  } catch (err) { next(err) }
}

export async function createCampaignController(req, res, next) {
  try {
    const campaign = await createCampaign({ ...req.body, createdBy: req.user.id })
    res.status(201).json({ success: true, data: campaign, message: "Campaign created" })
  } catch (err) { next(err) }
}

export async function startCampaignController(req, res, next) {
  try {
    const { id } = req.params
    const result = await startCampaign(id)
    res.json({ success: true, data: result })
  } catch (err) { next(err) }
}

export async function pauseCampaignController(req, res, next) {
  try {
    const { id } = req.params
    const result = await pauseCampaign(id)
    res.json({ success: true, data: result, message: "Campaign paused" })
  } catch (err) { next(err) }
}

export async function resumeCampaignController(req, res, next) {
  try {
    const { id } = req.params
    const result = await resumeCampaign(id)
    res.json({ success: true, data: result })
  } catch (err) { next(err) }
}

export async function cancelCampaignController(req, res, next) {
  try {
    const { id } = req.params
    const result = await cancelCampaign(id)
    res.json({ success: true, data: result, message: "Campaign cancelled" })
  } catch (err) { next(err) }
}

export async function getCampaignAnalyticsController(req, res, next) {
  try {
    const { id } = req.params
    const analytics = await getCampaignAnalytics(id)
    res.json({ success: true, data: analytics })
  } catch (err) { next(err) }
}

// ---------------------------------------------------------
// DASHBOARD / STATS
// ---------------------------------------------------------

export async function getDashboard(req, res, next) {
  try {
    const connections = await getConnectionStats()
    const totalMessages = await prisma.whatsAppMessage.count()
    const messagesByStatus = await prisma.whatsAppMessage.groupBy({
      by: ["status"],
      _count: { status: true },
    })
    const totalTemplates = await prisma.whatsAppTemplate.count()
    const activeCampaigns = await prisma.whatsAppCampaign.count({
      where: { status: { in: ["RUNNING", "SCHEDULED"] } },
    })

    const connectedCount = connections.filter((c) => c.status === "CONNECTED").length
    const totalSent = connections.reduce((sum, c) => sum + c.messagesSent, 0)
    const totalDelivered = connections.reduce((sum, c) => sum + c.messagesDelivered, 0)
    const totalFailed = connections.reduce((sum, c) => sum + c.messagesFailed, 0)
    const totalQueued = connections.reduce((sum, c) => sum + c.messagesQueued, 0)

    res.json({
      success: true,
      data: {
        connections,
        summary: {
          totalConnections: connections.length,
          connected: connectedCount,
          totalMessages,
          totalSent,
          totalDelivered,
          totalFailed,
          totalQueued,
          totalTemplates,
          activeCampaigns,
          messagesByStatus,
        },
      },
    })
  } catch (err) { next(err) }
}

// ---------------------------------------------------------
// INIT (called on server startup)
// ---------------------------------------------------------

export async function initWhatsAppEngine() {
  console.log("[WhatsApp] Initializing WhatsApp Engine...")

  // Seed default templates
  await seedDefaultTemplates()

  // Restore all active connections
  await restoreAllConnections()

  // Start heartbeat monitor (every 60 seconds)
  setInterval(async () => {
    await heartbeatMonitor().catch((err) => {
      console.error("[WhatsApp] Heartbeat error:", err.message)
    })
  }, 60000)

  // Start queue processor (every 15 seconds)
  setInterval(async () => {
    await processAllQueues().catch((err) => {
      console.error("[WhatsApp] Queue processing error:", err.message)
    })
  }, 15000)

  // Start scheduled campaign processor (every 60 seconds)
  setInterval(async () => {
    await processScheduledCampaigns().catch((err) => {
      console.error("[WhatsApp] Campaign scheduler error:", err.message)
    })
  }, 60000)

  // Cleanup expired OTPs (every 5 minutes)
  setInterval(async () => {
    await cleanupExpiredOTPs().catch((err) => {
      console.error("[WhatsApp] OTP cleanup error:", err.message)
    })
  }, 300000)

  console.log("[WhatsApp] Engine initialized — heartbeat, queue, campaign scheduler, OTP cleanup started")
}
