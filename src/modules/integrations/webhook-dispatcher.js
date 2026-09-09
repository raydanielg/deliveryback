import prisma from "../../prisma/client.js"
import crypto from "crypto"
import { decryptSecret } from "../../utils/encryption.js"

function signPayload(secret, timestamp, rawBody) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
}

// Attempt N -> N+1 waits this long. Exhausting the array (attempt 5) moves to FAILED —
// dead letter, not retried again automatically; an admin can manually requeue it.
const BACKOFF_SECONDS = [30, 120, 600, 1800]

async function logIntegration(fields) {
  await prisma.integrationLog.create({ data: fields }).catch((e) => console.error("Integration log write failed:", e.message))
}

async function updatePartnerHealth(partnerId) {
  const recent = await prisma.integrationLog.findMany({
    where: { partnerId, direction: "OUTBOUND" },
    orderBy: { createdAt: "desc" },
    take: 20,
  })
  if (recent.length === 0) return
  const failures = recent.filter((l) => l.result === "FAILURE").length
  const failureRate = failures / recent.length
  let health = "HEALTHY"
  if (failureRate >= 0.8) health = "FAILING"
  else if (failureRate >= 0.4) health = "DEGRADED"
  else if (failureRate > 0) health = "WARNING"

  const successField = failures === 0 ? { lastSuccessAt: new Date() } : {}
  const failureField = recent[0].result === "FAILURE" ? { lastFailureAt: new Date() } : {}
  await prisma.partner.update({ where: { id: partnerId }, data: { health, lastActivityAt: new Date(), ...successField, ...failureField } })
}

/** Sends one queued webhook delivery, signs it, and records the outcome + retry schedule. */
export async function deliverWebhook(delivery) {
  const partner = await prisma.partner.findUnique({ where: { id: delivery.partnerId } })
  if (!partner || partner.status !== "ACTIVE") {
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "DISABLED" } })
    return
  }

  const rawBody = JSON.stringify(delivery.payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const secret = decryptSecret(partner.webhookSecretEncrypted) || ""
  const signature = secret ? signPayload(secret, timestamp, rawBody) : ""

  const start = Date.now()
  let httpStatus = null
  let ok = false
  let errorMessage = null
  let responseText = ""

  try {
    const res = await fetch(delivery.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Xerin-Event": delivery.event,
        "X-Xerin-Event-Id": delivery.eventId,
        "X-Xerin-Timestamp": timestamp,
        "X-Xerin-Signature": signature,
      },
      body: rawBody,
      signal: AbortSignal.timeout(10000),
    })
    httpStatus = res.status
    ok = res.status >= 200 && res.status < 300
    responseText = (await res.text().catch(() => "")).slice(0, 500)
  } catch (err) {
    errorMessage = err.message
  }

  const latencyMs = Date.now() - start
  const nextAttempt = delivery.attempt + 1

  if (ok) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "DELIVERED", attempt: nextAttempt, httpStatus,
        responseTimeMs: latencyMs, responsePreview: responseText,
        deliveredAt: new Date(), lastError: null, nextRetryAt: null,
      },
    })
    await logIntegration({ partnerId: partner.id, direction: "OUTBOUND", event: delivery.event, endpoint: delivery.endpoint, httpStatus, latencyMs, result: "SUCCESS" })
  } else {
    // A network failure (no status) or a 5xx/429 is worth retrying; a 4xx the partner
    // returned deliberately (bad payload, auth) is not — retrying it forever can't help.
    const retryable = errorMessage != null || [500, 502, 503, 504, 429].includes(httpStatus)
    const exhausted = nextAttempt >= delivery.maxAttempts
    const status = !retryable || exhausted ? "FAILED" : "RETRYING"
    const backoffSeconds = BACKOFF_SECONDS[Math.min(nextAttempt - 1, BACKOFF_SECONDS.length - 1)]
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status, attempt: nextAttempt, httpStatus,
        responseTimeMs: latencyMs, responsePreview: responseText,
        lastError: errorMessage || `HTTP ${httpStatus}`,
        nextRetryAt: status === "RETRYING" ? new Date(Date.now() + backoffSeconds * 1000) : null,
      },
    })
    await logIntegration({ partnerId: partner.id, direction: "OUTBOUND", event: delivery.event, endpoint: delivery.endpoint, httpStatus, latencyMs, result: "FAILURE", message: errorMessage || `HTTP ${httpStatus}` })
  }

  await updatePartnerHealth(partner.id)
}

// Polls the DB for due deliveries and sends them, on an interval — a deliberately simple,
// dependency-free queue (no Redis/BullMQ in this stack) rather than sending webhooks inline
// inside the request that triggered the event, so an offline/slow partner endpoint can never
// make a customer-facing operation (booking, payment, status update) fail or hang.
let dispatcherInterval = null
export function startWebhookDispatcher({ intervalMs = 5000, batchSize = 20 } = {}) {
  if (dispatcherInterval) return
  dispatcherInterval = setInterval(async () => {
    try {
      const due = await prisma.webhookDelivery.findMany({
        where: { OR: [{ status: "PENDING" }, { status: "RETRYING", nextRetryAt: { lte: new Date() } }] },
        take: batchSize,
        orderBy: { createdAt: "asc" },
      })
      for (const delivery of due) {
        await deliverWebhook(delivery)
      }
    } catch (err) {
      console.error("Webhook dispatcher tick failed:", err.message)
    }
  }, intervalMs)
}

export function stopWebhookDispatcher() {
  if (dispatcherInterval) clearInterval(dispatcherInterval)
  dispatcherInterval = null
}
