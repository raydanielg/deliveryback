import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys"
import { Boom } from "@hapi/boom"
import { WhatsAppProviderInterface, PROVIDER_EVENTS } from "./provider-interface.js"
import { encryptSecret, decryptSecret } from "../../utils/encryption.js"

// ============================================================
// BAILEYS PROVIDER
// ============================================================
// Uses @whiskeysockets/baileys for WhatsApp Web multi-device API.
// Supports QR generation, persistent sessions, auto-reconnect.
// Session data is encrypted before storage using the same AES-256-GCM helper as the
// partner-integration credentials (random IV per call, auth tag stored alongside the
// ciphertext) — this module previously rolled its own encrypt/decrypt with a hardcoded
// all-zero IV reused on every call, which breaks AES-GCM's security guarantees entirely
// (nonce reuse allows keystream/plaintext recovery and forgery) and, since it never
// captured/verified the auth tag, meant decrypt() always failed and every restart
// silently forced a fresh QR scan regardless of "persistent session" intent.
function encrypt(text) {
  return encryptSecret(text)
}

function decrypt(encrypted) {
  try {
    return decryptSecret(encrypted)
  } catch {
    return null
  }
}

export class BaileysProvider extends WhatsAppProviderInterface {
  constructor(config = {}) {
    super(config)
    this.name = "baileys"
    this.sock = null
    this.connectionId = config.connectionId
    this.callbacks = new Map()
    this.sessionData = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 10
    this.reconnectDelay = 5000
    this.qrCode = null
    this.isConnected = false
  }

  on(event, callback) {
    if (!this.callbacks.has(event)) this.callbacks.set(event, [])
    this.callbacks.get(event).push(callback)
  }

  emit(event, data) {
    const cbs = this.callbacks.get(event) || []
    for (const cb of cbs) {
      try { cb(data) } catch (e) { console.error(`[Baileys] Event callback error for ${event}:`, e.message) }
    }
  }

  async connect() {
    const { version, isLatest } = await fetchLatestBaileysVersion()

    this.sock = makeWASocket({
      version,
      printQRInTerminal: false,
      auth: this.config.authState || null,
      browser: ["XERIN Express", "Chrome", "1.0.0"],
      markOnlineOnConnect: false,
      retryRequestDelayMs: 250,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 20000,
    })

    this._registerEventHandlers()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout — QR not generated"))
      }, 30000)

      this.on(PROVIDER_EVENTS.QR_GENERATED, (qr) => {
        clearTimeout(timeout)
        resolve({ qrCode: qr, status: "QR_REQUIRED" })
      })

      this.on(PROVIDER_EVENTS.CONNECTED, (data) => {
        clearTimeout(timeout)
        resolve({ status: "CONNECTED", ...data })
      })
    })
  }

  async restoreSession(savedSessionData) {
    try {
      const decrypted = decrypt(savedSessionData)
      if (!decrypted) {
        throw new Error("Failed to decrypt session data")
      }

      this.sessionData = JSON.parse(decrypted)
      const { version } = await fetchLatestBaileysVersion()

      this.sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: { creds: this.sessionData.creds, keys: this.sessionData.keys || {} },
        browser: ["XERIN Express", "Chrome", "1.0.0"],
        markOnlineOnConnect: false,
      })

      this._registerEventHandlers()

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Session restore timeout"))
        }, 15000)

        this.on(PROVIDER_EVENTS.CONNECTED, (data) => {
          clearTimeout(timeout)
          resolve({ status: "CONNECTED", ...data })
        })

        this.on(PROVIDER_EVENTS.SESSION_EXPIRED, () => {
          clearTimeout(timeout)
          resolve({ status: "SESSION_EXPIRED" })
        })

        this.on(PROVIDER_EVENTS.ERROR, (err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })
    } catch (err) {
      this.emit(PROVIDER_EVENTS.ERROR, err)
      throw err
    }
  }

  _registerEventHandlers() {
    if (!this.sock) return

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        this.qrCode = qr
        this.emit(PROVIDER_EVENTS.QR_GENERATED, qr)
      }

      if (connection === "close") {
        this.isConnected = false
        const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output.statusCode : null

        if (statusCode === DisconnectReason.loggedOut) {
          this.emit(PROVIDER_EVENTS.SESSION_EXPIRED, { reason: "logged_out" })
        } else if (statusCode === DisconnectReason.restartRequired) {
          this.emit(PROVIDER_EVENTS.DISCONNECTED, { reason: "restart_required", statusCode })
          this._attemptReconnect()
        } else {
          this.emit(PROVIDER_EVENTS.DISCONNECTED, { reason: "connection_closed", statusCode })
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this._attemptReconnect()
          } else {
            this.emit(PROVIDER_EVENTS.ERROR, new Error("Max reconnection attempts reached"))
          }
        }
      } else if (connection === "open") {
        this.isConnected = true
        this.reconnectAttempts = 0
        const user = this.sock.user
        this.emit(PROVIDER_EVENTS.CONNECTED, {
          accountId: user?.id?.split(":")[0],
          accountName: user?.name || user?.notify,
        })
      } else if (connection === "connecting") {
        this.emit(PROVIDER_EVENTS.CONNECTION_UPDATE, { status: "connecting" })
      }
    })

    this.sock.ev.on("creds.update", () => {
      if (this.sock?.authState) {
        const creds = this.sock.authState.creds
        const keys = this.sock.authState.keys
        if (creds) {
          const sessionJson = JSON.stringify({ creds, keys })
          const encrypted = encrypt(sessionJson)
          this.emit(PROVIDER_EVENTS.SESSION_SAVED, encrypted)
        }
      }
    })

    this.sock.ev.on("messages.upsert", (upsert) => {
      if (upsert.type === "notify") {
        for (const msg of upsert.messages) {
          const from = msg.key.remoteJid
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ""
          if (from && text) {
            this.emit(PROVIDER_EVENTS.MESSAGE_RECEIVED, { from, text, messageId: msg.key.id })
          }
        }
      }
    })

    this.sock.ev.on("message-receipt.update", (updates) => {
      for (const update of updates) {
        if (update.receipt?.receiptType === "read") {
          this.emit(PROVIDER_EVENTS.MESSAGE_READ, { key: update.key })
        } else {
          this.emit(PROVIDER_EVENTS.MESSAGE_DELIVERED, { key: update.key })
        }
      }
    })
  }

  async _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit(PROVIDER_EVENTS.ERROR, new Error("Max reconnection attempts reached"))
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5)
    this.emit(PROVIDER_EVENTS.CONNECTION_UPDATE, { status: "reconnecting", attempt: this.reconnectAttempts, delay })

    setTimeout(async () => {
      try {
        if (this.sessionData) {
          await this.restoreSession(encrypt(JSON.stringify(this.sessionData)))
        } else {
          await this.connect()
        }
      } catch (err) {
        console.error(`[Baileys] Reconnect attempt ${this.reconnectAttempts} failed:`, err.message)
        this._attemptReconnect()
      }
    }, delay)
  }

  async sendMessage(recipient, message, options = {}) {
    if (!this.sock || !this.isConnected) {
      throw new Error("WhatsApp not connected")
    }

    const jid = recipient.includes("@") ? recipient : `${recipient}@s.whatsapp.net`

    const sent = await this.sock.sendMessage(jid, {
      text: message,
    }, options)

    return {
      providerMessageId: sent?.key?.id || null,
      status: "SENT",
    }
  }

  async disconnect(destroy = false) {
    this.isConnected = false
    if (this.sock) {
      try {
        if (destroy) {
          await this.sock.logout()
        } else {
          await this.sock.end(new Error("Manual disconnect"))
        }
      } catch (e) {
        console.error("[Baileys] Disconnect error:", e.message)
      }
      this.sock = null
    }
    this.emit(PROVIDER_EVENTS.DISCONNECTED, { reason: "manual" })
  }

  getStatus() {
    return {
      connected: this.isConnected,
      hasSession: !!this.sessionData,
      reconnectAttempts: this.reconnectAttempts,
      qrCode: this.qrCode,
    }
  }
}

export { encrypt, decrypt }
