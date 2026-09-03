import app from "./app.js"
import dotenv from "dotenv"

dotenv.config()

const PORT = process.env.PORT || 4000

const server = app.listen(PORT, () => {
  console.log(`\n[Delivery Option API] Server running on port ${PORT}`)
  console.log(`[Delivery Option API] Health check: http://localhost:${PORT}/health`)
  console.log(`[Delivery Option API] Auth routes: http://localhost:${PORT}/api/auth`)
  console.log(`[Delivery Option API] Environment: ${process.env.NODE_ENV || "development"}\n`)
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
