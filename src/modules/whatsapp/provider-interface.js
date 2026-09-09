// ============================================================
// WHATSAPP PROVIDER INTERFACE
// ============================================================
// Abstraction layer for WhatsApp messaging providers.
// The Communication Engine does not care which provider is used.
// Each provider implements: connect, generateQR, restoreSession,
// sendMessage, disconnect, getStatus, handleWebhook.
// ============================================================

export class WhatsAppProviderInterface {
  constructor(config = {}) {
    this.config = config
    this.name = "base"
  }

  // Start a new connection (generates QR)
  async connect() {
    throw new Error("connect() not implemented")
  }

  // Restore an existing session from saved credentials
  async restoreSession(sessionData) {
    throw new Error("restoreSession() not implemented")
  }

  // Send a text message
  async sendMessage(recipient, message, options = {}) {
    throw new Error("sendMessage() not implemented")
  }

  // Disconnect and optionally destroy session
  async disconnect(destroy = false) {
    throw new Error("disconnect() not implemented")
  }

  // Get current connection status
  getStatus() {
    throw new Error("getStatus() not implemented")
  }

  // Handle incoming webhook (delivery status, incoming messages)
  async handleWebhook(payload) {
    throw new Error("handleWebhook() not implemented")
  }

  // Register event callbacks
  on(event, callback) {
    throw new Error("on() not implemented")
  }
}

// Provider event types
export const PROVIDER_EVENTS = {
  QR_GENERATED: "qr",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  CONNECTION_UPDATE: "connection.update",
  MESSAGE_RECEIVED: "message.received",
  MESSAGE_SENT: "message.sent",
  MESSAGE_DELIVERED: "message.delivered",
  MESSAGE_READ: "message.read",
  MESSAGE_FAILED: "message.failed",
  SESSION_SAVED: "session.saved",
  SESSION_EXPIRED: "session.expired",
  ERROR: "error",
}
