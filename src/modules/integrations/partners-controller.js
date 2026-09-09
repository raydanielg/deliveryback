import prisma from "../../prisma/client.js"
import crypto from "crypto"
import { createPartnerSchema, updatePartnerSchema, createApiKeySchema } from "./validation.js"
import { encryptSecret, decryptSecretJson, generateApiKey } from "../../utils/encryption.js"
import { deliverWebhook } from "./webhook-dispatcher.js"
import { logAction } from "../../middleware/audit-logger.js"

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

// Never let a secret reach an API response — only a display-safe hint of what's configured.
function maskAuthConfig(authMethod, config) {
  if (!config) return null
  switch (authMethod) {
    case "API_KEY":
      return { headerName: config.headerName || "X-API-Key", apiKey: config.apiKey ? `****${config.apiKey.slice(-4)}` : null }
    case "BEARER":
      return { token: config.token ? `****${config.token.slice(-4)}` : null }
    case "BASIC":
      return { username: config.username || null, password: config.password ? "********" : null }
    case "OAUTH2":
      return {
        clientId: config.clientId || null,
        clientSecret: config.clientSecret ? "********" : null,
        authorizationUrl: config.authorizationUrl || null,
        tokenUrl: config.tokenUrl || null,
        scopes: config.scopes || null,
        hasAccessToken: !!config.accessToken,
      }
    case "CUSTOM":
      return { headerName: config.headerName || null, headerValue: config.headerValue ? "********" : null }
    default:
      return null
  }
}

function toSafePartner(partner) {
  const authConfig = partner.authConfigEncrypted ? decryptSecretJson(partner.authConfigEncrypted) : null
  return {
    ...partner,
    authConfigEncrypted: undefined,
    webhookSecretEncrypted: undefined,
    authConfig: maskAuthConfig(partner.authMethod, authConfig),
    hasWebhookSecret: !!partner.webhookSecretEncrypted,
  }
}

export async function listPartners(req, res, next) {
  try {
    const partners = await prisma.partner.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { apiKeys: true, webhookDeliveries: true } } },
    })
    res.json({ success: true, data: partners.map(toSafePartner) })
  } catch (err) { next(err) }
}

export async function getPartner(req, res, next) {
  try {
    const partner = await prisma.partner.findUnique({ where: { id: req.params.id } })
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found" })
    res.json({ success: true, data: toSafePartner(partner) })
  } catch (err) { next(err) }
}

export async function createPartner(req, res, next) {
  try {
    const data = createPartnerSchema.parse(req.body)

    let slug = slugify(data.name)
    const existing = await prisma.partner.findUnique({ where: { slug } })
    if (existing) slug = `${slug}-${crypto.randomBytes(3).toString("hex")}`

    // Auto-generate a webhook secret if the operator didn't supply one — a partner with a
    // webhookUrl but no secret would mean unsigned outbound payloads, which defeats the
    // point of the signature header.
    const webhookSecret = data.webhookSecret || (data.webhookUrl ? crypto.randomBytes(24).toString("hex") : null)

    const partner = await prisma.partner.create({
      data: {
        name: data.name,
        slug,
        company: data.company,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        apiBaseUrl: data.apiBaseUrl || null,
        authMethod: data.authMethod,
        authConfigEncrypted: data.authConfig ? encryptSecret(data.authConfig) : null,
        webhookUrl: data.webhookUrl || null,
        webhookSecretEncrypted: webhookSecret ? encryptSecret(webhookSecret) : null,
        subscribedEvents: data.subscribedEvents,
        scopes: data.scopes,
        status: data.status,
        notes: data.notes,
        createdById: req.user?.id,
        health: data.status === "ACTIVE" ? "HEALTHY" : "DISABLED",
      },
    })

    await logAction({ userId: req.user?.id, action: "INTEGRATION_CREATED", entity: "partner", entityId: partner.id, changes: { name: data.name, authMethod: data.authMethod }, req })

    res.status(201).json({
      success: true,
      data: {
        ...toSafePartner(partner),
        // Shown exactly once — the same rule as an API key. The admin must copy it now.
        webhookSecretOnceOnly: data.webhookSecret ? undefined : webhookSecret,
      },
      message: "Partner integration created",
    })
  } catch (err) { next(err) }
}

export async function updatePartner(req, res, next) {
  try {
    const { id } = req.params
    const data = updatePartnerSchema.parse(req.body)

    const existing = await prisma.partner.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ success: false, message: "Partner not found" })

    const updateData = {}
    for (const field of ["name", "company", "contactEmail", "contactPhone", "apiBaseUrl", "authMethod", "webhookUrl", "subscribedEvents", "scopes", "status", "notes"]) {
      if (data[field] !== undefined) updateData[field] = data[field]
    }
    if (data.authConfig !== undefined) updateData.authConfigEncrypted = encryptSecret(data.authConfig)
    if (data.webhookSecret !== undefined) updateData.webhookSecretEncrypted = encryptSecret(data.webhookSecret)
    if (updateData.status && updateData.status !== "ACTIVE") updateData.health = "DISABLED"

    const partner = await prisma.partner.update({ where: { id }, data: updateData })

    await logAction({ userId: req.user?.id, action: "INTEGRATION_UPDATED", entity: "partner", entityId: id, changes: updateData, req })

    res.json({ success: true, data: toSafePartner(partner), message: "Partner updated" })
  } catch (err) { next(err) }
}

export async function setPartnerStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status } = req.body
    if (!["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING", "ERROR"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" })
    }
    const partner = await prisma.partner.update({
      where: { id },
      data: { status, health: status === "ACTIVE" ? "HEALTHY" : "DISABLED" },
    })
    await logAction({ userId: req.user?.id, action: status === "ACTIVE" ? "INTEGRATION_ENABLED" : "INTEGRATION_DISABLED", entity: "partner", entityId: id, req })
    res.json({ success: true, data: toSafePartner(partner) })
  } catch (err) { next(err) }
}

export async function deletePartner(req, res, next) {
  try {
    const { id } = req.params
    // Archive, don't destroy — a partner's shipment/order history must stay attributable.
    const partner = await prisma.partner.update({ where: { id }, data: { status: "INACTIVE", health: "DISABLED" } })
    await logAction({ userId: req.user?.id, action: "INTEGRATION_DISABLED", entity: "partner", entityId: id, changes: { archived: true }, req })
    res.json({ success: true, data: toSafePartner(partner), message: "Partner archived" })
  } catch (err) { next(err) }
}

export async function testWebhook(req, res, next) {
  try {
    const { id } = req.params
    const partner = await prisma.partner.findUnique({ where: { id } })
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found" })
    if (!partner.webhookUrl) return res.status(400).json({ success: false, message: "This partner has no webhook URL configured" })

    const eventId = `evt_test_${crypto.randomBytes(8).toString("hex")}`
    const delivery = await prisma.webhookDelivery.create({
      data: {
        eventId,
        partnerId: partner.id,
        event: "test.ping",
        endpoint: partner.webhookUrl,
        payload: { event: "test.ping", event_id: eventId, timestamp: new Date().toISOString(), partner_id: partner.id, data: { message: "This is a test webhook from Xerin Express" } },
        status: "PENDING",
        isTest: true,
      },
    })

    await deliverWebhook(delivery)
    const result = await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })

    res.json({
      success: true,
      data: {
        status: result.status,
        httpStatus: result.httpStatus,
        responseTimeMs: result.responseTimeMs,
        responsePreview: result.responsePreview,
        lastError: result.lastError,
      },
    })
  } catch (err) { next(err) }
}

export async function listPartnerLogs(req, res, next) {
  try {
    const { id } = req.params
    const { direction, page = 1, limit = 50 } = req.query
    const where = { partnerId: id }
    if (direction) where.direction = direction
    const [logs, total] = await Promise.all([
      prisma.integrationLog.findMany({ where, orderBy: { createdAt: "desc" }, take: Number(limit), skip: (Number(page) - 1) * Number(limit) }),
      prisma.integrationLog.count({ where }),
    ])
    res.json({ success: true, data: logs, meta: { page: Number(page), limit: Number(limit), total } })
  } catch (err) { next(err) }
}

export async function listPartnerWebhookDeliveries(req, res, next) {
  try {
    const { id } = req.params
    const { status, page = 1, limit = 50 } = req.query
    const where = { partnerId: id }
    if (status) where.status = status
    const [deliveries, total] = await Promise.all([
      prisma.webhookDelivery.findMany({ where, orderBy: { createdAt: "desc" }, take: Number(limit), skip: (Number(page) - 1) * Number(limit) }),
      prisma.webhookDelivery.count({ where }),
    ])
    res.json({ success: true, data: deliveries, meta: { page: Number(page), limit: Number(limit), total } })
  } catch (err) { next(err) }
}

export async function retryWebhookDelivery(req, res, next) {
  try {
    const { deliveryId } = req.params
    const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } })
    if (!delivery) return res.status(404).json({ success: false, message: "Delivery not found" })
    await prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { status: "PENDING", nextRetryAt: null } })
    await logAction({ userId: req.user?.id, action: "WEBHOOK_RETRIED", entity: "webhook_delivery", entityId: deliveryId, req })
    res.json({ success: true, message: "Delivery requeued" })
  } catch (err) { next(err) }
}

export async function integrationsDashboard(req, res, next) {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [total, active, inactive, failedHealth, eventsToday, deliveredToday, failedToday] = await Promise.all([
      prisma.partner.count(),
      prisma.partner.count({ where: { status: "ACTIVE" } }),
      prisma.partner.count({ where: { status: { in: ["INACTIVE", "SUSPENDED"] } } }),
      prisma.partner.count({ where: { health: "FAILING" } }),
      prisma.webhookDelivery.count({ where: { createdAt: { gte: since24h } } }),
      prisma.webhookDelivery.count({ where: { createdAt: { gte: since24h }, status: "DELIVERED" } }),
      prisma.webhookDelivery.count({ where: { createdAt: { gte: since24h }, status: "FAILED" } }),
    ])
    res.json({ success: true, data: { total, active, inactive, failed: failedHealth, eventsToday, deliveredToday, failedToday } })
  } catch (err) { next(err) }
}

// --- API keys ---

export async function listApiKeys(req, res, next) {
  try {
    const keys = await prisma.partnerApiKey.findMany({
      where: { partnerId: req.params.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, keyPrefix: true, scopes: true, environment: true, status: true, lastUsedAt: true, expiresAt: true, createdAt: true, revokedAt: true },
    })
    res.json({ success: true, data: keys })
  } catch (err) { next(err) }
}

export async function createApiKey(req, res, next) {
  try {
    const { id: partnerId } = req.params
    const data = createApiKeySchema.parse(req.body)
    const partner = await prisma.partner.findUnique({ where: { id: partnerId } })
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found" })

    const { key, prefix, hash } = generateApiKey(data.environment)
    const record = await prisma.partnerApiKey.create({
      data: {
        partnerId,
        label: data.label,
        keyPrefix: prefix,
        keyHash: hash,
        scopes: data.scopes.length ? data.scopes : partner.scopes,
        environment: data.environment,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        createdById: req.user?.id,
      },
    })

    await logAction({ userId: req.user?.id, action: "API_KEY_CREATED", entity: "partner_api_key", entityId: record.id, changes: { partnerId }, req })

    res.status(201).json({
      success: true,
      data: { id: record.id, keyPrefix: prefix, environment: data.environment, scopes: record.scopes, apiKey: key },
      message: "API key created — this is the only time the full key is shown.",
    })
  } catch (err) { next(err) }
}

export async function revokeApiKey(req, res, next) {
  try {
    const { keyId } = req.params
    const key = await prisma.partnerApiKey.update({ where: { id: keyId }, data: { status: "REVOKED", revokedAt: new Date() } })
    await logAction({ userId: req.user?.id, action: "API_KEY_REVOKED", entity: "partner_api_key", entityId: keyId, req })
    res.json({ success: true, data: { id: key.id, status: key.status } })
  } catch (err) { next(err) }
}
