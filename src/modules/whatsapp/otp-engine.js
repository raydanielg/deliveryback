import prisma from "../../prisma/client.js"
import crypto from "crypto"
import { queueMessage } from "./messaging-service.js"

// ============================================================
// WHATSAPP OTP ENGINE
// ============================================================
// Secure OTP generation, delivery via WhatsApp, verification.
// Security: expiry, max attempts, resend cooldown, rate limiting.
// ============================================================

const OTP_EXPIRY_MINUTES = 10
const OTP_RESEND_COOLDOWN_SECONDS = 60
const MAX_RESEND_PER_HOUR = 5

// ---------------------------------------------------------
// GENERATE AND SEND OTP
// ---------------------------------------------------------

export async function sendOTP(phone, purpose = "LOGIN") {
  const normalizedPhone = normalizePhone(phone)

  // Rate limiting: check recent OTPs
  const recentOTPs = await prisma.whatsAppOTP.findMany({
    where: {
      phone: normalizedPhone,
      purpose,
      createdAt: { gte: new Date(Date.now() - 3600000) }, // last 1 hour
    },
  })

  if (recentOTPs.length >= MAX_RESEND_PER_HOUR) {
    throw new Error("Too many OTP requests. Please try again later.")
  }

  // Check resend cooldown
  const lastOTP = recentOTPs[recentOTPs.length - 1]
  if (lastOTP && lastOTP.resendAvailableAt && new Date() < lastOTP.resendAvailableAt) {
    const waitSec = Math.ceil((lastOTP.resendAvailableAt - new Date()) / 1000)
    throw new Error(`Please wait ${waitSec} seconds before requesting a new OTP.`)
  }

  // Generate secure 6-digit OTP
  const otp = String(crypto.randomInt(100000, 999999))

  // Hash OTP (never store plaintext)
  const otpHash = crypto.createHash("sha256").update(otp).digest("hex")

  // Save OTP record
  const otpRecord = await prisma.whatsAppOTP.create({
    data: {
      phone: normalizedPhone,
      otpHash,
      purpose,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000),
      resendAvailableAt: new Date(Date.now() + OTP_RESEND_COOLDOWN_SECONDS * 1000),
    },
  })

  // Find a connected WhatsApp connection
  const conn = await prisma.whatsAppConnection.findFirst({
    where: {
      isActive: true,
      status: "CONNECTED",
      OR: [
        { purpose: "customer_care" },
        { purpose: null },
      ],
    },
  })

  if (!conn) {
    throw new Error("No WhatsApp connection available for OTP delivery")
  }

  // Queue OTP message
  await queueMessage({
    connectionId: conn.id,
    recipient: normalizedPhone,
    eventType: "OTP",
    variables: { otp },
    metadata: { otpId: otpRecord.id, purpose },
  })

  return { success: true, otpId: otpRecord.id, message: "OTP sent via WhatsApp" }
}

// ---------------------------------------------------------
// VERIFY OTP
// ---------------------------------------------------------

export async function verifyOTP(phone, otp, purpose = "LOGIN") {
  const normalizedPhone = normalizePhone(phone)

  // Find the most recent unverified, unexpired OTP
  const otpRecord = await prisma.whatsAppOTP.findFirst({
    where: {
      phone: normalizedPhone,
      purpose,
      verifiedAt: null,
      expiresAt: { gte: new Date() },
    },
    orderBy: { createdAt: "desc" },
  })

  if (!otpRecord) {
    return { success: false, message: "No valid OTP found. Please request a new one." }
  }

  // Check max attempts
  if (otpRecord.attempts >= otpRecord.maxAttempts) {
    // Invalidate OTP
    await prisma.whatsAppOTP.update({
      where: { id: otpRecord.id },
      data: { expiresAt: new Date() },
    })
    return { success: false, message: "Maximum OTP attempts exceeded. Please request a new one." }
  }

  // Increment attempts
  await prisma.whatsAppOTP.update({
    where: { id: otpRecord.id },
    data: { attempts: { increment: 1 } },
  })

  // Hash the provided OTP and compare
  const providedHash = crypto.createHash("sha256").update(otp).digest("hex")

  if (providedHash !== otpRecord.otpHash) {
    const remaining = otpRecord.maxAttempts - otpRecord.attempts - 1
    return { success: false, message: `Invalid OTP. ${remaining} attempts remaining.` }
  }

  // OTP verified — mark as verified
  await prisma.whatsAppOTP.update({
    where: { id: otpRecord.id },
    data: { verifiedAt: new Date() },
  })

  return { success: true, message: "OTP verified successfully" }
}

// ---------------------------------------------------------
// CLEANUP EXPIRED OTPs (called periodically)
// ---------------------------------------------------------

export async function cleanupExpiredOTPs() {
  const result = await prisma.whatsAppOTP.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
      verifiedAt: null,
    },
  })
  if (result.count > 0) {
    console.log(`[WhatsApp OTP] Cleaned up ${result.count} expired OTPs`)
  }
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
