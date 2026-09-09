import prisma from "../../prisma/client.js"
import { getProvider } from "./connection-manager.js"
import { renderTemplate, getTemplateByEvent } from "./template-engine.js"
import { sendSms } from "../auth/sms.service.js"
import { emitEvent, EVENTS } from "../integrations/event-bus.js"

// ============================================================
// WHATSAPP MESSAGING SERVICE
// ============================================================
// Central messaging engine — all WhatsApp messages go through here.
// Supports queue, retry, SMS fallback, delivery tracking.
// ============================================================

const MAX_RETRIES = 3
const RETRY_DELAYS = [60000, 300000, 900000] // 1min, 5min, 15min

// ---------------------------------------------------------
// QUEUE MESSAGE (create + queue, non-blocking)
// ---------------------------------------------------------

export async function queueMessage({ connectionId, recipient, templateName, variables, eventType, shipmentId, metadata, recipientName }) {
  // Validate connection exists and is active
  const conn = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } })
  if (!conn || !conn.isActive) {
    throw new Error("WhatsApp connection not found or inactive")
  }

  // Get template
  let template = null
  let messageBody = ""

  if (templateName) {
    template = await prisma.whatsAppTemplate.findUnique({ where: { name: templateName } })
    if (!template) throw new Error(`Template "${templateName}" not found`)
    messageBody = renderTemplate(template.body, variables || {})
  } else if (eventType) {
    template = await getTemplateByEvent(eventType)
    if (template) {
      messageBody = renderTemplate(template.body, variables || {})
    } else {
      // No template found — skip
      return null
    }
  } else {
    throw new Error("Either templateName or eventType is required")
  }

  // Create message record
  const message = await prisma.whatsAppMessage.create({
    data: {
      connectionId,
      recipient: normalizePhone(recipient),
      recipientName: recipientName || null,
      messageBody,
      templateId: template?.id || null,
      templateName: template?.name || null,
      eventType: eventType || template?.eventType || null,
      shipmentId: shipmentId || null,
      metadata: metadata || null,
      status: "QUEUED",
      maxRetries: MAX_RETRIES,
    },
  })

  // Update connection queued count
  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: { messagesQueued: { increment: 1 } },
  })

  // Try to send immediately if connected
  _processQueue(connectionId).catch((err) => {
    console.error("[WhatsApp] Queue processing error:", err.message)
  })

  return message
}

// ---------------------------------------------------------
// PROCESS QUEUE (send pending messages for a connection)
// ---------------------------------------------------------

export async function _processQueue(connectionId) {
  const provider = await getProvider(connectionId)
  if (!provider || !provider.isConnected) return

  const pending = await prisma.whatsAppMessage.findMany({
    where: {
      connectionId,
      status: { in: ["QUEUED", "RETRYING"] },
      nextRetryAt: { lte: new Date() },
    },
    orderBy: { queuedAt: "asc" },
    take: 20,
  })

  for (const msg of pending) {
    await _sendSingleMessage(msg, provider)
  }
}

// ---------------------------------------------------------
// PROCESS ALL QUEUES (called by worker)
// ---------------------------------------------------------

export async function processAllQueues() {
  const connections = await prisma.whatsAppConnection.findMany({
    where: { isActive: true, status: "CONNECTED" },
    select: { id: true },
  })

  for (const conn of connections) {
    await _processQueue(conn.id).catch(() => {})
  }

  // Also process retrying messages
  await _processRetries()
}

// ---------------------------------------------------------
// SEND SINGLE MESSAGE
// ---------------------------------------------------------

async function _sendSingleMessage(msg, provider) {
  try {
    // Update status to SENDING
    await prisma.whatsAppMessage.update({
      where: { id: msg.id },
      data: { status: "SENDING" },
    })

    const result = await provider.sendMessage(msg.recipient, msg.messageBody)

    // Update message as SENT
    await prisma.whatsAppMessage.update({
      where: { id: msg.id },
      data: {
        status: "SENT",
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
      },
    })

    // Update connection stats
    await prisma.whatsAppConnection.update({
      where: { id: msg.connectionId },
      data: {
        messagesSent: { increment: 1 },
        messagesQueued: { decrement: 1 },
        lastMessageAt: new Date(),
      },
    })

    // Log to notification log
    await prisma.notificationLog.create({
      data: {
        recipient: msg.recipient,
        channel: "WHATSAPP",
        provider: "baileys",
        providerId: result.providerMessageId,
        status: "SENT",
        sentAt: new Date(),
      },
    })

    console.log(`[WhatsApp] Message sent to ${msg.recipient} (ID: ${result.providerMessageId})`)
  } catch (err) {
    console.error(`[WhatsApp] Send failed for ${msg.id}:`, err.message)

    // Check if we should retry
    if (msg.retryCount < msg.maxRetries) {
      const delay = RETRY_DELAYS[msg.retryCount] || 900000
      await prisma.whatsAppMessage.update({
        where: { id: msg.id },
        data: {
          status: "RETRYING",
          retryCount: { increment: 1 },
          nextRetryAt: new Date(Date.now() + delay),
          errorMessage: err.message,
        },
      })
    } else {
      // Max retries reached — mark as failed, try SMS fallback
      await prisma.whatsAppMessage.update({
        where: { id: msg.id },
        data: {
          status: "FAILED",
          errorMessage: err.message,
          failedAt: new Date(),
        },
      })

      await prisma.whatsAppConnection.update({
        where: { id: msg.connectionId },
        data: {
          messagesFailed: { increment: 1 },
          messagesQueued: { decrement: 1 },
        },
      })

      // SMS Fallback
      await _smsFallback(msg)
    }
  }
}

// ---------------------------------------------------------
// PROCESS RETRIES
// ---------------------------------------------------------

async function _processRetries() {
  const retrying = await prisma.whatsAppMessage.findMany({
    where: {
      status: "RETRYING",
      nextRetryAt: { lte: new Date() },
    },
    take: 20,
  })

  for (const msg of retrying) {
    const provider = await getProvider(msg.connectionId)
    if (provider && provider.isConnected) {
      await _sendSingleMessage(msg, provider)
    }
  }
}

// ---------------------------------------------------------
// SMS FALLBACK
// ---------------------------------------------------------

async function _smsFallback(msg) {
  try {
    const template = msg.templateId
      ? await prisma.whatsAppTemplate.findUnique({ where: { id: msg.templateId } })
      : null

    const smsBody = template?.smsBody
      ? template.smsBody
      : msg.messageBody.substring(0, 160)

    await sendSms(msg.recipient, smsBody)

    await prisma.whatsAppMessage.update({
      where: { id: msg.id },
      data: { smsFallbackSent: true },
    })

    await prisma.notificationLog.create({
      data: {
        recipient: msg.recipient,
        channel: "SMS",
        provider: "mshastra",
        status: "SENT",
        sentAt: new Date(),
      },
    })

    console.log(`[WhatsApp] SMS fallback sent to ${msg.recipient}`)
  } catch (smsErr) {
    console.error(`[WhatsApp] SMS fallback failed for ${msg.recipient}:`, smsErr.message)
  }
}

// ---------------------------------------------------------
// UPDATE DELIVERY STATUS (from provider webhook)
// ---------------------------------------------------------

export async function updateDeliveryStatus(connectionId, providerMessageId, status) {
  const msg = await prisma.whatsAppMessage.findFirst({
    where: { connectionId, providerMessageId },
  })

  if (!msg) return

  const updateData = {}
  if (status === "DELIVERED") {
    updateData.status = "DELIVERED"
    updateData.deliveredAt = new Date()
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { messagesDelivered: { increment: 1 } },
    })
  } else if (status === "READ") {
    updateData.status = "READ"
    updateData.readAt = new Date()
  }

  await prisma.whatsAppMessage.update({
    where: { id: msg.id },
    data: updateData,
  })
}

// ---------------------------------------------------------
// SEND TEST MESSAGE
// ---------------------------------------------------------

export async function sendTestMessage(connectionId, recipient, message) {
  return queueMessage({
    connectionId,
    recipient,
    templateName: null,
    eventType: null,
    variables: {},
    metadata: { test: true },
    recipientName: "Test",
  })
}

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function normalizePhone(phone) {
  let clean = phone.replace(/\s+/g, "").replace(/^\+/, "")
  if (clean.startsWith("0")) {
    clean = "255" + clean.substring(1)
  }
  return clean
}

// ---------------------------------------------------------
// EVENT TRIGGER (called from XERIN events)
// ---------------------------------------------------------

export async function triggerEventNotification(eventType, shipmentId, variables = {}) {
  // Find a connected connection for transactional messages
  const conn = await prisma.whatsAppConnection.findFirst({
    where: {
      isActive: true,
      status: "CONNECTED",
      OR: [
        { purpose: "customer_care" },
        { purpose: "operations" },
        { purpose: null },
      ],
    },
  })

  if (!conn) {
    // No connected WhatsApp — skip silently (don't block operations)
    return null
  }

  // Get recipient from shipment
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      trackingNumber: true,
      createdById: true,
      fromPhone: true,
      toPhone: true,
      fromFullName: true,
      toFullName: true,
    },
  })

  if (!shipment) return null

  // Determine recipient phone
  const recipient = shipment.toPhone || shipment.fromPhone
  if (!recipient) return null

  const recipientName = shipment.toFullName || shipment.fromFullName || "Customer"

  return queueMessage({
    connectionId: conn.id,
    recipient,
    recipientName,
    eventType,
    shipmentId,
    variables: {
      customer_name: recipientName,
      tracking_number: shipment.trackingNumber,
      tracking_url: `${process.env.CLIENT_URL || "https://deliveryoptionfrontend-web.vercel.app"}/track/${shipment.trackingNumber}`,
      ...variables,
    },
  })
}
