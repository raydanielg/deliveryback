import rateLimit from "express-rate-limit"

// Applied to every /api/v1 request. Previously only the auth routes had any rate limiting
// at all — every other endpoint, including unauthenticated ones like the public tracking
// lookup and the payment gateway webhooks, had no request-volume protection whatsoever.
// This is a generous baseline (dashboards legitimately poll/list a lot); it's a backstop
// against abuse and scraping, not meant to constrain normal usage.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
})

// Tighter limit for public, unauthenticated endpoints that are the most attractive targets
// for scripted abuse (payment webhooks impersonating a gateway, tracking-number enumeration).
export const publicEndpointLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
})

// Per-partner limit on the external integration API (Part O) — keyed by partner id (set by
// authenticatePartner, which must run first), not by IP, so one partner's volume can never
// exhaust another's quota and a partner behind a shared NAT/proxy isn't wrongly throttled.
export const partnerApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.partner?.id || req.ip,
  message: { success: false, message: "Rate limit exceeded for this partner. Try again shortly." },
})
