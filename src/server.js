import app from "./app.js"
import dotenv from "dotenv"
import { startWebhookDispatcher } from "./modules/integrations/webhook-dispatcher.js"
import { initWhatsAppEngine } from "./modules/whatsapp/controller.js"
import { initWhatsAppEventIntegration } from "./modules/whatsapp/event-integration.js"

dotenv.config()

const PORT = process.env.PORT || 4000

const server = app.listen(PORT, () => {
  console.log(`\n[Delivery Option API] Server running on port ${PORT}`)
  console.log(`[Delivery Option API] Health check: http://localhost:${PORT}/health`)
  console.log(`[Delivery Option API] Auth routes: http://localhost:${PORT}/api/auth`)
  console.log(`[Delivery Option API] Environment: ${process.env.NODE_ENV || "development"}\n`)
  startWebhookDispatcher()
  initWhatsAppEngine().catch((err) => console.error("[WhatsApp] Init error:", err.message))
  initWhatsAppEventIntegration()
})

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err)
  server.close(() => process.exit(1))
})

process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...")
  server.close(() => {
    console.log("Process terminated.")
    process.exit(0)
  })
})
