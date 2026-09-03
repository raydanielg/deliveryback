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
import { errorHandler, notFound } from "./middleware/errorHandler.js"

dotenv.config()

const app = express()

app.set("trust proxy", 1)

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000,https://xerinexpress.com,https://www.xerinexpress.com")
  .split(",")
  .map((o) => o.trim())

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(null, true)
      }
    },
    credentials: true,
  })
)

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
    strictTransportSecurity: false,
  })
)
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// Serve uploaded files statically
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")))

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Xerin Delivery API is running",
    timestamp: new Date().toISOString(),
    version: "2.0.0",
  })
})

// Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "Xerin Delivery API Docs",
  customfavIcon: "/assets/favicon.png",
  swaggerOptions: {
    docExpansion: "none",
    filter: true,
    showRequestDuration: true,
  },
}))

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

app.use(notFound)
app.use(errorHandler)

export default app
