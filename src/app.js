import express from "express"
import cors from "cors"
import helmet from "helmet"
import cookieParser from "cookie-parser"
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"
import swaggerUi from "swagger-ui-express"
import { swaggerSpec } from "./config/swagger.js"

import authRoutes from "./modules/auth/routes.js"
import pricingRoutes from "./modules/pricing/routes.js"
import quotesRoutes from "./modules/quotes/routes.js"
import shipmentsRoutes from "./modules/shipments/routes.js"
import trackingRoutes from "./modules/tracking/routes.js"
import driversRoutes from "./modules/drivers/routes.js"
import carriersRoutes from "./modules/carriers/routes.js"
import vehiclesRoutes from "./modules/vehicles/routes.js"
import manifestsRoutes from "./modules/manifests/routes.js"
import waybillsRoutes from "./modules/waybills/routes.js"
import paymentsRoutes from "./modules/payments/routes.js"
import geographyRoutes from "./modules/geography/routes.js"
import notificationsRoutes from "./modules/notifications/routes.js"
import customsRoutes from "./modules/customs/routes.js"
import documentsRoutes from "./modules/documents/routes.js"
import customersRoutes from "./modules/customers/routes.js"
import ordersRoutes from "./modules/orders/routes.js"
import parcelCategoriesRoutes from "./modules/parcel-categories/routes.js"
import parcelWeightsRoutes from "./modules/parcel-weights/routes.js"
import parcelFaresRoutes from "./modules/parcel-fares/routes.js"
import paymentGatewaysRoutes from "./modules/payment-gateways/routes.js"
import surgePricingRoutes from "./modules/surge-pricing/routes.js"
import zonesRoutes from "./modules/zones/routes.js"
import usersRoutes from "./modules/users/routes.js"
import settingsRoutes from "./modules/settings/routes.js"
import stationsRoutes from "./modules/stations/routes.js"
import notificationServiceRoutes from "./modules/notification-service/routes.js"
import exceptionsRoutes from "./modules/exceptions/routes.js"
import capacityRoutes from "./modules/capacity/routes.js"
import blogRoutes from "./modules/blog/routes.js"
import sgrServiceRoutes from "./modules/sgr-service/routes.js"
import airCargoRoutes from "./modules/air-cargo/routes.js"
import warehouseRoutes from "./modules/warehouse/routes.js"
import bookingRoutes from "./modules/booking/routes.js"
import reportsRoutes from "./modules/reports/routes.js"
import trainCapacityRoutes from "./modules/train-capacity/routes.js"
import marketplaceIntegrationsRoutes from "./modules/marketplace-integrations/routes.js"
import claimsRoutes from "./modules/claims/routes.js"
import ticketsRoutes from "./modules/tickets/routes.js"
import addressesRoutes from "./modules/addresses/routes.js"
import packagesRoutes from "./modules/packages/routes.js"
import integrationsRoutes from "./modules/integrations/routes.js"
import dispatchRoutes from "./modules/dispatch/routes.js"
import transportRoutes from "./modules/transport/routes.js"
import tripRoutes from "./modules/trips/routes.js"
import whatsappRoutes from "./modules/whatsapp/routes.js"
import dubaiReceivingRoutes from "./modules/dubai-receiving/routes.js"
import consolidationBoxesRoutes from "./modules/consolidation-boxes/routes.js"
import tripManifestsRoutes from "./modules/trip-manifests/routes.js"
import shelfLocationsRoutes from "./modules/shelf-locations/routes.js"
import cargoIntakeRoutes from "./modules/cargo-intake/routes.js"
import deliveryConfigRoutes from "./modules/delivery-config/routes.js"
import paymentApprovalsRoutes from "./modules/payment-approvals/routes.js"
import invoicingRoutes from "./modules/invoicing/routes.js"
import deliveryRegisterRoutes from "./modules/delivery-register/routes.js"
import scanRoutes from "./modules/scan/routes.js"
import dashboardRoutes from "./modules/dashboard/routes.js"
import logisticsRoutes from "./modules/logistics/routes.js"
import branchRoutes, { emergencyRouter } from "./modules/branches/routes.js"
import { initWhatsAppEngine } from "./modules/whatsapp/controller.js"
import { initWhatsAppEventIntegration } from "./modules/whatsapp/event-integration.js"
import { listAuditLogs } from "./middleware/audit-logger.js"
import { authenticate, authorizeRoles } from "./middleware/auth.js"
import { errorHandler, notFound } from "./middleware/errorHandler.js"
import { verifyEmailConnection, sendAccountDeletionRequest } from "./modules/auth/email.service.js"
import { sendSms } from "./modules/auth/sms.service.js"
import { apiLimiter, adminLimiter, paymentLimiter } from "./middleware/rate-limit.js"
import { writeRequestLog } from "./lib/request-log.js"

dotenv.config()

const app = express()

app.disable("x-powered-by")
app.set("trust proxy", 1)

// Lightweight request logger — prints method, URL, status code and duration for
// every incoming request, and appends a JSON-lines record to logs/requests.log so
// the admin CLI (`npm run admin` -> `monitor`) can render a live request table.
app.use((req, res, next) => {
  const start = Date.now()
  res.on("finish", () => {
    const ms = Date.now() - start
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`)
    writeRequestLog({
      ts: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ms,
      ip: req.ip,
    })
  })
  next()
})

const isProduction = process.env.NODE_ENV === "production"
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

app.use(
  cors({
    origin: (origin, cb) => {
      // Non-browser clients (curl, mobile apps, server-to-server) send no Origin — allow.
      if (!origin) return cb(null, true)
      // Development: accept requests from any origin.
      if (!isProduction) return cb(null, true)
      // Always allow localhost / loopback so local frontends and tools can reach the API.
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) return cb(null, true)
      // Production: only the configured allowlist.
      if (allowedOrigins.includes(origin)) return cb(null, true)
      cb(new Error("Not allowed by CORS"))
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    credentials: true,
    maxAge: 86400,
  })
)

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
    strictTransportSecurity: isProduction ? { maxAge: 86400 } : false,
  })
)
// Capture the raw request body alongside the parsed one so webhook handlers
// (payment gateways) can verify HMAC signatures over the exact bytes received.
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf
    },
  })
)
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// Serve uploaded files statically
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")))

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Xerin Express API is running",
    timestamp: new Date().toISOString(),
    version: "2.0.0",
  })
})

app.get("/health/messaging", async (req, res) => {
  const results = { email: {}, sms: {} }

  const emailOk = await verifyEmailConnection()
  results.email = {
    connected: emailOk,
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
  }

  if (process.env.SMS_PASSWORD) {
    try {
      const r = await sendSms("255700000000", "Xerin Express test message")
      results.sms = { connected: true, response: r.providerId }
    } catch (err) {
      results.sms = { connected: false, error: err.message }
    }
  } else {
    results.sms = { connected: false, error: "SMS_PASSWORD not set" }
  }

  res.status(200).json({ success: true, data: results })
})

// Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "Xerin Express API Docs",
  customfavIcon: "/assets/favicon.png",
  swaggerOptions: {
    docExpansion: "none",
    filter: true,
    showRequestDuration: true,
  },
}))

// Baseline rate limit across the whole API — previously only /api/v1/auth had any request
// throttling, leaving every other endpoint (including unauthenticated ones) unprotected.
// This is a generous baseline (dashboards legitimately poll/list a lot); it's a backstop
// against abuse and scraping, not meant to constrain normal usage.
app.use("/api/v1", apiLimiter)

// Tighter rate limits for payment and admin surfaces.
app.use("/api/v1/payments", paymentLimiter)
app.use("/api/v1/payment-approvals", paymentLimiter)
app.use("/api/v1/users", adminLimiter)
app.use("/api/v1/settings", adminLimiter)

app.use("/api/v1/auth", authRoutes)
app.use("/api/v1/pricing", pricingRoutes)
app.use("/api/v1/quotes", quotesRoutes)
app.use("/api/v1/shipments", shipmentsRoutes)
app.use("/api/v1/tracking", trackingRoutes)
app.use("/api/v1/drivers", driversRoutes)
app.use("/api/v1/carriers", carriersRoutes)
app.use("/api/v1/vehicles", vehiclesRoutes)
app.use("/api/v1/manifests", manifestsRoutes)
app.use("/api/v1/waybills", waybillsRoutes)
app.use("/api/v1/payments", paymentsRoutes)
app.use("/api/v1/geography", geographyRoutes)
app.use("/api/v1/notifications", notificationsRoutes)
app.use("/api/v1/customs", customsRoutes)
app.use("/api/v1/documents", documentsRoutes)
app.use("/api/v1/customers", customersRoutes)
app.use("/api/v1/orders", ordersRoutes)
app.use("/api/v1/parcel-categories", parcelCategoriesRoutes)
app.use("/api/v1/parcel-weights", parcelWeightsRoutes)
app.use("/api/v1/parcel-fares", parcelFaresRoutes)
app.use("/api/v1/payment-gateways", paymentGatewaysRoutes)
app.use("/api/v1/surge-pricing", surgePricingRoutes)
app.use("/api/v1/zones", zonesRoutes)
app.use("/api/v1/users", usersRoutes)
app.use("/api/v1/settings", settingsRoutes)
app.use("/api/v1/stations", stationsRoutes)
app.use("/api/v1/notification-service", notificationServiceRoutes)
app.use("/api/v1/exceptions", exceptionsRoutes)
app.use("/api/v1/capacity", capacityRoutes)
app.use("/api/v1/blog", blogRoutes)
app.use("/api/v1/sgr", sgrServiceRoutes)
app.use("/api/v1/air-cargo", airCargoRoutes)
app.use("/api/v1/warehouse", warehouseRoutes)
app.use("/api/v1/booking", bookingRoutes)
app.use("/api/v1/reports", reportsRoutes)
app.use("/api/v1/train-capacity", trainCapacityRoutes)
app.use("/api/v1/marketplace-integrations", marketplaceIntegrationsRoutes)
app.use("/api/v1/claims", claimsRoutes)
app.use("/api/v1/support/tickets", ticketsRoutes)
app.use("/api/v1/addresses", addressesRoutes)
app.use("/api/v1/packages", packagesRoutes)
app.use("/api/v1/integrations", integrationsRoutes)
app.use("/api/v1/dispatch", dispatchRoutes)
app.use("/api/v1/transport", transportRoutes)
app.use("/api/v1/trips", tripRoutes)
app.use("/api/v1/whatsapp", whatsappRoutes)
// Dubai<->Tanzania consolidation, passenger trip manifests, shelf locations, delivery
// config, payment approval and the unified scan-resolve endpoint.
app.use("/api/v1/consolidation-boxes", consolidationBoxesRoutes)
app.use("/api/v1/trip-manifests", tripManifestsRoutes)
app.use("/api/v1/shelf-locations", shelfLocationsRoutes)
app.use("/api/v1/cargo-intake", cargoIntakeRoutes)
app.use("/api/v1/invoicing", invoicingRoutes)
app.use("/api/v1/delivery-register", deliveryRegisterRoutes)
app.use("/api/v1/delivery-config", deliveryConfigRoutes)
app.use("/api/v1/payment-approvals", paymentApprovalsRoutes)
app.use("/api/v1/dubai-receiving", dubaiReceivingRoutes)
app.use("/api/v1/scan", scanRoutes)
app.use("/api/v1/dashboard", dashboardRoutes)
app.use("/api/v1/logistics", logisticsRoutes)
app.use("/api/v1/branches", branchRoutes)
app.use("/api/v1/emergencies", emergencyRouter)

// Data deletion information page for Google Play Data safety form
app.get("/data-deletion", (req, res) => {
  res.setHeader("Content-Type", "text/html")
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Xerin Express - Data & Account Deletion</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 720px; margin: 2rem auto; padding: 1rem; color: #111; }
    h1 { color: #0f4c81; }
    a { color: #0f4c81; }
  </style>
</head>
<body>
  <h1>Xerin Express — Data & Account Deletion</h1>
  <p>If you would like to delete your Xerin Express account and all associated personal data, you can request deletion at any time.</p>
  <h2>How to request deletion</h2>
  <ul>
    <li>Email us at <a href="mailto:support@xerinexpress.com">support@xerinexpress.com</a> with the subject "Account Deletion Request" and include the email address or phone number associated with your account.</li>
    <li>Our support team will process your request within 30 days and send you a confirmation once your data has been deleted.</li>
  </ul>
  <h2>What data is deleted</h2>
  <p>Upon confirmation, we delete your profile information, addresses, saved shipment history, payment tokens, and other personal data linked to your account.</p>
  <h2>Data we may retain</h2>
  <p>We may retain certain records for legal, tax, fraud-prevention, or regulatory purposes for as long as required by applicable law. This retained data is not used to identify or contact you.</p>
  <p><strong>Last updated:</strong> ${new Date().toISOString().split("T")[0]}</p>
</body>
</html>`)
})

// Public account deletion request endpoint (required by Google Play Data safety)
app.post("/api/v1/account-deletion", async (req, res, next) => {
  try {
    const { email, phone = "", reason = "" } = req.body

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "A valid email address is required" })
    }

    await sendAccountDeletionRequest(email, reason)
    res.status(200).json({
      success: true,
      message: "Your account deletion request has been received. Our support team will contact you within 30 days.",
    })
  } catch (err) {
    next(err)
  }
})

// Audit logs
app.get("/api/v1/audit-logs", authenticate, authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), listAuditLogs)

app.use(notFound)
app.use(errorHandler)

export default app
