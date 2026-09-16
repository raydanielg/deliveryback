import rateLimit from "express-rate-limit"

const limit = (options) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...options,
  })

const message = (text) => ({ success: false, message: text })

const clientKey = (req, fallback = "anon") =>
  req.user?.id ? `user:${req.user.id}` : `ip:${req.ip || fallback}`

const identityKey = (req, fields = ["email", "phone"], fallback = "anon") => {
  for (const f of fields) {
    const v = req.body?.[f]
    if (v) return `${req.ip || "ip"}-${String(v).toLowerCase()}`
  }
  return `${req.ip || "ip"}-${fallback}`
}

// General API: 100 requests / minute / IP (generous for dashboards, backstop for abuse)
export const apiLimiter = limit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.ip,
  message: message("Too many requests. Please try again later."),
  skip: (req) => req.path === "/health" || req.path === "/health/messaging",
})

// Login / register / pin-login: 5 attempts / 15 minutes / IP + identity
export const loginLimiter = limit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => identityKey(req, ["email", "badgeCode"]),
  message: message("Too many login attempts. Please try again later."),
})

// OTP (email or phone): 3 requests / 10 minutes / identity
export const otpLimiter = limit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => identityKey(req, ["phone", "email"]),
  message: message("Too many OTP requests. Please try again later."),
})

// Password reset (forgot + reset): 5 requests / hour / IP
export const passwordResetLimiter = limit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip,
  message: message("Too many password reset requests. Please try again later."),
})

// Payment flow: 30 requests / minute / authenticated user (falls back to IP if unauthenticated)
export const paymentLimiter = limit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => clientKey(req),
  message: message("Too many payment requests. Please try again later."),
})

// Admin / sensitive endpoints: 120 requests / minute / authenticated user (falls back to IP)
export const adminLimiter = limit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => clientKey(req),
  message: message("Too many admin requests. Please try again later."),
})

// Public, unauthenticated endpoints (tracking, webhooks, etc.)
export const publicEndpointLimiter = limit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.ip,
  message: message("Too many requests. Please try again later."),
})

// Per-partner limit on the external integration API — keyed by partner id.
export const partnerApiLimiter = limit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.partner?.id || req.ip,
  message: message("Rate limit exceeded for this partner. Try again shortly."),
})
