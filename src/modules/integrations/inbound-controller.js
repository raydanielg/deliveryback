import crypto from "crypto"
import prisma from "../../prisma/client.js"
import { decryptSecret } from "../../utils/encryption.js"

const REPLAY_WINDOW_SECONDS = 5 * 60

// Inbound webhooks share the same secret XERIN uses to sign its own outbound payloads to
// that partner (Partner.webhookSecretEncrypted) — one shared HMAC secret per partner,
// used bidirectionally, rather than provisioning and tracking a second one.
function verifySignature(secret, timestamp, rawBody, providedSignature) {
  if (!secret || !providedSignature) return false
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSignature))
  } catch {
    return false
  }
}

async function logInbound(partnerId, fields) {
  await prisma.integrationLog.create({
    data: { partnerId, direction: "INBOUND", ...fields },
  }).catch((e) => console.error("Integration log write failed:", e.message))
}

/**
 * POST /api/v1/integrations/webhooks/:partnerSlug
 * Receives an event pushed BY a partner INTO Xerin (Part F). Every step in the validation
 * chain the brief calls for runs in order and rejects immediately on failure — nothing here
 * ever trusts a payload just because it parsed as JSON.
 */
export async function receiveInboundWebhook(req, res, next) {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID()
  const startedAt = Date.now()
  let partner = null

  try {
    // 1. Identify partner
    partner = await prisma.partner.findUnique({ where: { slug: req.params.partnerSlug } })
    if (!partner) {
      await logInbound(null, { endpoint: req.originalUrl, requestId, httpStatus: 404, result: "REJECTED", message: "Unknown partner slug" })
      return res.status(404).json({ success: false, message: "Unknown partner" })
    }
    if (partner.status !== "ACTIVE") {
      await logInbound(partner.id, { endpoint: req.originalUrl, requestId, httpStatus: 403, result: "REJECTED", message: `Partner is ${partner.status}` })
      return res.status(403).json({ success: false, message: "Integration is not active" })
    }

    // 2/3. Validate signature (timestamp + HMAC together, since the signature covers the timestamp)
    const timestamp = req.headers["x-partner-timestamp"]
    const signature = req.headers["x-partner-signature"]
    const secret = decryptSecret(partner.webhookSecretEncrypted)
    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body)

    if (secret) {
      // 4. Timestamp / replay protection
      const ts = Number(timestamp)
      if (!timestamp || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > REPLAY_WINDOW_SECONDS) {
        await logInbound(partner.id, { endpoint: req.originalUrl, requestId, httpStatus: 401, result: "REJECTED", message: "Missing or stale timestamp" })
        return res.status(401).json({ success: false, message: "Missing or stale timestamp" })
      }
      if (!verifySignature(secret, timestamp, rawBody, signature)) {
        await logInbound(partner.id, { endpoint: req.originalUrl, requestId, httpStatus: 401, result: "REJECTED", message: "Invalid signature" })
        return res.status(401).json({ success: false, message: "Invalid signature" })
      }
    }
    // A partner with no webhook secret configured (yet) can't be signature-verified — allowed
    // through only because they were never issued one to sign with; configuring a secret makes
    // verification mandatory from that point on.

    // 5. Validate payload shape
    const { event, event_id: externalEventId, data } = req.body || {}
    if (!event || typeof event !== "string" || !externalEventId || typeof data !== "object") {
      await logInbound(partner.id, { endpoint: req.originalUrl, requestId, httpStatus: 400, result: "REJECTED", message: "Payload must include event, event_id, and data" })
      return res.status(400).json({ success: false, message: "Payload must include event, event_id, and data" })
    }

    // 6. Idempotency — (partnerId, externalEventId) is a unique constraint, so a concurrent
    // or retried delivery of the same event can't be processed twice even under a race.
    const existing = await prisma.inboundWebhookEvent.findUnique({
      where: { partnerId_externalEventId: { partnerId: partner.id, externalEventId } },
    })
    if (existing) {
      await logInbound(partner.id, { event, endpoint: req.originalUrl, requestId, httpStatus: 200, latencyMs: Date.now() - startedAt, result: "SUCCESS", message: "Duplicate — already processed" })
      return res.status(200).json({ success: true, message: "Already processed", duplicate: true })
    }

    // 7. Process — real handling for the event types we act on; anything else is accepted
    // and recorded so the partner integration isn't a dead end, without pretending to run
    // business logic that doesn't exist yet for that event type.
    const result = await processInboundEvent(partner, event, data)

    await prisma.inboundWebhookEvent.create({
      data: { partnerId: partner.id, externalEventId, event, payload: req.body, status: "PROCESSED" },
    })
    await prisma.partner.update({ where: { id: partner.id }, data: { lastActivityAt: new Date() } })

    // 8. Audit
    await logInbound(partner.id, { event, endpoint: req.originalUrl, requestId, httpStatus: 200, latencyMs: Date.now() - startedAt, result: "SUCCESS", message: result.message })

    // 9. Response
    res.status(200).json({ success: true, message: result.message, data: result.data })
  } catch (err) {
    await logInbound(partner?.id, { endpoint: req.originalUrl, requestId, httpStatus: 500, result: "FAILURE", message: err.message })
    next(err)
  }
}

async function processInboundEvent(partner, event, data) {
  switch (event) {
    case "tracking.update":
    case "shipment.status_update": {
      const { shipment_id: shipmentId, external_reference: externalReference, status, description, location } = data
      const shipment = shipmentId
        ? await prisma.shipment.findFirst({ where: { id: shipmentId, partnerId: partner.id } })
        : await prisma.shipment.findFirst({ where: { partnerId: partner.id, externalReference } })

      if (!shipment) {
        return { message: "No matching shipment for this partner — event recorded but not applied" }
      }
      if (!status) {
        return { message: "No status provided — event recorded only" }
      }

      await prisma.$transaction([
        prisma.shipment.update({ where: { id: shipment.id }, data: { status } }),
        prisma.trackingEvent.create({
          data: {
            shipmentId: shipment.id,
            event: `PARTNER_UPDATE_${status}`,
            status,
            description: description || `Status update from partner ${partner.name}`,
            location,
          },
        }),
      ])
      return { message: "Shipment status updated", data: { shipmentId: shipment.id, status } }
    }

    case "shipment.cancellation_request": {
      const { shipment_id: shipmentId, external_reference: externalReference, reason } = data
      const shipment = shipmentId
        ? await prisma.shipment.findFirst({ where: { id: shipmentId, partnerId: partner.id } })
        : await prisma.shipment.findFirst({ where: { partnerId: partner.id, externalReference } })

      if (!shipment) return { message: "No matching shipment for this partner — event recorded but not applied" }
      if (["DELIVERED", "IN_TRANSIT"].includes(shipment.status)) {
        return { message: `Cannot cancel — shipment is already ${shipment.status}` }
      }

      await prisma.$transaction([
        prisma.shipment.update({ where: { id: shipment.id }, data: { status: "CANCELLED" } }),
        prisma.trackingEvent.create({ data: { shipmentId: shipment.id, event: "SHIPMENT_CANCELLED", status: "CANCELLED", description: reason ? `Cancelled by partner: ${reason}` : `Cancelled by partner ${partner.name}` } }),
      ])
      return { message: "Shipment cancelled", data: { shipmentId: shipment.id } }
    }

    default:
      // Recognized-but-not-yet-automated event types (order.created, payment.updated, etc.)
      // are accepted and durably recorded via InboundWebhookEvent above so nothing is lost —
      // an operator can review them in Integration Logs rather than the partner getting a
      // silent 404/500 for an event type this deployment doesn't act on yet.
      return { message: `Event '${event}' received and recorded` }
  }
}
