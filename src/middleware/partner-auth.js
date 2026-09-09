import crypto from "crypto"
import prisma from "../prisma/client.js"
import { hashApiKey } from "../utils/encryption.js"

// Authenticates an external partner calling the integration API (Part H/I). This is
// intentionally a completely separate identity system from the staff JWT auth in auth.js —
// a leaked/misused partner key can only ever act as that one partner, scoped by its own
// key's scopes, and req.partner below is what every integration-API handler filters by
// (Part J — a partner must never be able to reach another partner's data).
export async function authenticatePartner(req, res, next) {
  try {
    const apiKeyHeader = req.headers["x-api-key"]
    const authHeader = req.headers.authorization
    const rawKey = apiKeyHeader || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null)

    if (!rawKey) {
      return res.status(401).json({ success: false, message: "Missing API key. Provide it via X-API-Key or Authorization: Bearer <key>." })
    }

    const apiKey = await prisma.partnerApiKey.findUnique({
      where: { keyHash: hashApiKey(rawKey) },
      include: { partner: true },
    })

    if (!apiKey) {
      return res.status(401).json({ success: false, message: "Invalid API key" })
    }
    if (apiKey.expiresAt && apiKey.expiresAt < new Date() && apiKey.status === "ACTIVE") {
      await prisma.partnerApiKey.update({ where: { id: apiKey.id }, data: { status: "EXPIRED" } })
      apiKey.status = "EXPIRED"
    }
    if (apiKey.status !== "ACTIVE") {
      return res.status(401).json({ success: false, message: `API key is ${apiKey.status.toLowerCase()}` })
    }
    if (apiKey.partner.status !== "ACTIVE") {
      return res.status(403).json({ success: false, message: `Partner integration is ${apiKey.partner.status.toLowerCase()}` })
    }

    prisma.partnerApiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
    prisma.partner.update({ where: { id: apiKey.partner.id }, data: { lastActivityAt: new Date() } }).catch(() => {})

    req.partner = apiKey.partner
    req.partnerApiKey = apiKey
    next()
  } catch (err) { next(err) }
}

export function requireScope(scope) {
  return (req, res, next) => {
    if (!req.partnerApiKey?.scopes?.includes(scope)) {
      return res.status(403).json({ success: false, message: `API key missing required scope: ${scope}` })
    }
    next()
  }
}

let systemUserId = null
// Every partner-originated Order/Shipment still needs a `createdById` (User FK) — this is
// the shared, non-login attribution anchor for "created by an external partner via API"
// rather than any real staff/customer account.
export async function getOrCreateIntegrationSystemUser() {
  if (systemUserId) return systemUserId
  const email = "integration-system@internal.xerinexpress"
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: "Partner Integration System",
        email,
        password: crypto.randomBytes(32).toString("hex"), // unusable for login — never communicated
        role: "PARTNER_API",
        isVerified: true,
        isActive: true,
      },
    })
  }
  systemUserId = user.id
  return systemUserId
}
