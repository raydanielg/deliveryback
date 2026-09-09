import prisma from "../../prisma/client.js"
import { renderTemplate } from "./template-engine.js"
import { getProvider } from "./connection-manager.js"

// ============================================================
// WHATSAPP CAMPAIGN ENGINE
// ============================================================
// Marketing campaigns with rate limiting, scheduling, consent,
// opt-out, duplicate prevention, retry, analytics.
// ============================================================

// ---------------------------------------------------------
// CREATE CAMPAIGN
// ---------------------------------------------------------

export async function createCampaign({ name, description, connectionId, templateId, audienceType, audienceFilter, scheduledAt, sendRate, dailyLimit, optOutEnabled, createdBy }) {
  // Validate connection
  const conn = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } })
  if (!conn) throw new Error("WhatsApp connection not found")

  // Validate template
  const template = await prisma.whatsAppTemplate.findUnique({ where: { id: templateId } })
  if (!template) throw new Error("Template not found")

  // Build audience
  const recipients = await _buildAudience(audienceType, audienceFilter)

  const campaign = await prisma.whatsAppCampaign.create({
    data: {
      name,
      description,
      connectionId,
      templateId,
      audienceType: audienceType || "ALL_CUSTOMERS",
      audienceFilter: audienceFilter || null,
      recipientCount: recipients.length,
      scheduledAt: scheduledAt || null,
      sendRate: sendRate || 10,
      dailyLimit: dailyLimit || null,
      optOutEnabled: optOutEnabled !== false,
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
      createdBy,
    },
  })

  // Create recipient records
  if (recipients.length > 0) {
    const recipientData = recipients.map((r) => ({
      campaignId: campaign.id,
      recipient: r.phone,
      recipientName: r.name,
      userId: r.userId,
      status: "QUEUED",
    }))

    // Batch insert
    for (let i = 0; i < recipientData.length; i += 100) {
      await prisma.whatsAppCampaignRecipient.createMany({
        data: recipientData.slice(i, i + 100),
        skipDuplicates: true,
      })
    }
  }

  return campaign
}

// ---------------------------------------------------------
// START CAMPAIGN
// ---------------------------------------------------------

export async function startCampaign(campaignId) {
  const campaign = await prisma.whatsAppCampaign.findUnique({
    where: { id: campaignId },
    include: { connection: true, template: true },
  })

  if (!campaign) throw new Error("Campaign not found")
  if (campaign.status === "RUNNING") throw new Error("Campaign already running")
  if (campaign.connection.status !== "CONNECTED") throw new Error("WhatsApp connection not connected")

  await prisma.whatsAppCampaign.update({
    where: { id: campaignId },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
    },
  })

  // Start sending in background (non-blocking)
  _processCampaign(campaignId).catch((err) => {
    console.error(`[WhatsApp Campaign] Processing error for ${campaignId}:`, err.message)
  })

  return { success: true, message: "Campaign started" }
}

// ---------------------------------------------------------
// PROCESS CAMPAIGN (internal — sends messages with rate limiting)
// ---------------------------------------------------------

async function _processCampaign(campaignId) {
  const campaign = await prisma.whatsAppCampaign.findUnique({
    where: { id: campaignId },
    include: { template: true, connection: true },
  })

  if (!campaign || campaign.status !== "RUNNING") return

  const provider = await getProvider(campaign.connectionId)
  if (!provider || !provider.isConnected) {
    console.log(`[WhatsApp Campaign] Connection not ready for campaign ${campaignId}, pausing...`)
    await prisma.whatsAppCampaign.update({
      where: { id: campaignId },
      data: { status: "PAUSED" },
    })
    return
  }

  const batchSize = Math.min(campaign.sendRate, 20)
  const delayBetweenBatches = 60000 // 1 minute between batches

  while (campaign.status === "RUNNING") {
    const pending = await prisma.whatsAppCampaignRecipient.findMany({
      where: {
        campaignId,
        status: "QUEUED",
        optedOut: false,
      },
      take: batchSize,
      orderBy: { createdAt: "asc" },
    })

    if (pending.length === 0) {
      // All recipients processed — complete campaign
      await prisma.whatsAppCampaign.update({
        where: { id: campaignId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      })
      console.log(`[WhatsApp Campaign] Campaign ${campaignId} completed`)
      break
    }

    for (const recipient of pending) {
      try {
        // Render template with variables
        const messageBody = renderTemplate(campaign.template.body, {
          customer_name: recipient.recipientName || "Customer",
        })

        // Send via provider
        const result = await provider.sendMessage(recipient.recipient, messageBody)

        // Create WhatsApp message record
        const msg = await prisma.whatsAppMessage.create({
          data: {
            connectionId: campaign.connectionId,
            recipient: recipient.recipient,
            recipientName: recipient.recipientName,
            messageBody,
            templateId: campaign.templateId,
            templateName: campaign.template.name,
            eventType: "MARKETING",
            providerMessageId: result.providerMessageId,
            status: "SENT",
            sentAt: new Date(),
          },
        })

        // Update recipient
        await prisma.whatsAppCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            messageId: msg.id,
            status: "SENT",
            sentAt: new Date(),
          },
        })

        // Update campaign stats
        await prisma.whatsAppCampaign.update({
          where: { id: campaignId },
          data: {
            totalSent: { increment: 1 },
          },
        })

        // Update connection stats
        await prisma.whatsAppConnection.update({
          where: { id: campaign.connectionId },
          data: { messagesSent: { increment: 1 } },
        })
      } catch (err) {
        console.error(`[WhatsApp Campaign] Failed to send to ${recipient.recipient}:`, err.message)

        await prisma.whatsAppCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "FAILED",
            failedAt: new Date(),
            errorMessage: err.message,
          },
        })

        await prisma.whatsAppCampaign.update({
          where: { id: campaignId },
          data: { totalFailed: { increment: 1 } },
        })
      }

      // Small delay between individual messages
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    // Wait between batches
    await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches))

    // Re-fetch campaign status (may have been paused)
    const updated = await prisma.whatsAppCampaign.findUnique({ where: { id: campaignId } })
    if (!updated || updated.status !== "RUNNING") break
  }
}

// ---------------------------------------------------------
// PAUSE CAMPAIGN
// ---------------------------------------------------------

export async function pauseCampaign(campaignId) {
  return prisma.whatsAppCampaign.update({
    where: { id: campaignId },
    data: { status: "PAUSED" },
  })
}

// ---------------------------------------------------------
// RESUME CAMPAIGN
// ---------------------------------------------------------

export async function resumeCampaign(campaignId) {
  const campaign = await prisma.whatsAppCampaign.findUnique({ where: { id: campaignId } })
  if (!campaign) throw new Error("Campaign not found")
  if (campaign.status !== "PAUSED") throw new Error("Campaign is not paused")

  await prisma.whatsAppCampaign.update({
    where: { id: campaignId },
    data: { status: "RUNNING" },
  })

  _processCampaign(campaignId).catch((err) => {
    console.error(`[WhatsApp Campaign] Resume error for ${campaignId}:`, err.message)
  })

  return { success: true, message: "Campaign resumed" }
}

// ---------------------------------------------------------
// CANCEL CAMPAIGN
// ---------------------------------------------------------

export async function cancelCampaign(campaignId) {
  await prisma.whatsAppCampaignRecipient.updateMany({
    where: { campaignId, status: "QUEUED" },
    data: { status: "CANCELLED" },
  })

  return prisma.whatsAppCampaign.update({
    where: { id: campaignId },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
    },
  })
}

// ---------------------------------------------------------
// GET CAMPAIGN ANALYTICS
// ---------------------------------------------------------

export async function getCampaignAnalytics(campaignId) {
  const campaign = await prisma.whatsAppCampaign.findUnique({
    where: { id: campaignId },
    include: {
      template: { select: { name: true, body: true } },
      connection: { select: { name: true, status: true } },
    },
  })

  if (!campaign) throw new Error("Campaign not found")

  const recipientStats = await prisma.whatsAppCampaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { status: true },
  })

  return {
    campaign,
    recipientStats,
    progress: {
      total: campaign.recipientCount,
      sent: campaign.totalSent,
      delivered: campaign.totalDelivered,
      failed: campaign.totalFailed,
      read: campaign.totalRead,
      pending: campaign.recipientCount - campaign.totalSent - campaign.totalFailed,
    },
  }
}

// ---------------------------------------------------------
// BUILD AUDIENCE
// ---------------------------------------------------------

async function _buildAudience(audienceType, audienceFilter) {
  let users = []

  if (audienceType === "ALL_CUSTOMERS" || !audienceType) {
    users = await prisma.user.findMany({
      where: { role: "CUSTOMER", isActive: true, phone: { not: null } },
      select: { id: true, name: true, phone: true },
    })
  } else if (audienceType === "FILTERED" && audienceFilter) {
    users = await prisma.user.findMany({
      where: {
        role: "CUSTOMER",
        isActive: true,
        phone: { not: null },
        ...audienceFilter,
      },
      select: { id: true, name: true, phone: true },
    })
  } else {
    // UPLOAD — audienceFilter contains array of phones
    if (Array.isArray(audienceFilter)) {
      users = audienceFilter.map((item) => ({
        phone: item.phone,
        name: item.name || "Customer",
        userId: null,
      }))
    }
  }

  return users.map((u) => ({
    phone: u.phone,
    name: u.name || "Customer",
    userId: u.id || null,
  }))
}

// ---------------------------------------------------------
// PROCESS SCHEDULED CAMPAIGNS (called by worker)
// ---------------------------------------------------------

export async function processScheduledCampaigns() {
  const scheduled = await prisma.whatsAppCampaign.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: new Date() },
    },
  })

  for (const campaign of scheduled) {
    try {
      await startCampaign(campaign.id)
      console.log(`[WhatsApp Campaign] Started scheduled campaign: ${campaign.name}`)
    } catch (err) {
      console.error(`[WhatsApp Campaign] Failed to start scheduled campaign ${campaign.id}:`, err.message)
    }
  }
}
