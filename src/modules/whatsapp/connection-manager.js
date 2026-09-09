import prisma from "../../prisma/client.js"
import { BaileysProvider } from "./baileys-provider.js"
import { PROVIDER_EVENTS } from "./provider-interface.js"

// ============================================================
// WHATSAPP CONNECTION MANAGER
// ============================================================
// Manages all WhatsApp connections: start, restore, monitor,
// reconnect, disconnect, logout, health monitoring.
// Supports multiple simultaneous connections.
// ============================================================

const connections = new Map() // connectionId -> BaileysProvider

export async function getProvider(connectionId) {
  return connections.get(connectionId)
}

export async function listActiveConnections() {
  return prisma.whatsAppConnection.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  })
}

// ---------------------------------------------------------
// START NEW CONNECTION (generates QR)
// ---------------------------------------------------------

export async function startConnection(connectionId, connectionName, createdBy) {
  // Create DB record if not exists
  let conn = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } })
  if (!conn) {
    conn = await prisma.whatsAppConnection.create({
      data: {
        id: connectionId,
        name: connectionName,
        provider: "baileys",
        status: "CONNECTING",
        createdBy,
      },
    })
  }

  // Clean up any existing provider instance
  const existing = connections.get(connectionId)
  if (existing) {
    try { await existing.disconnect(false) } catch {}
    connections.delete(connectionId)
  }

  const provider = new BaileysProvider({ connectionId })
  connections.set(connectionId, provider)

  // Register event handlers
  _registerProviderEvents(connectionId, provider)

  try {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { status: "CONNECTING" },
    })

    const result = await provider.connect()

    if (result.qrCode) {
      await prisma.whatsAppConnection.update({
        where: { id: connectionId },
        data: {
          status: "QR_REQUIRED",
          qrCode: result.qrCode,
        },
      })
      return { status: "QR_REQUIRED", qrCode: result.qrCode }
    }

    return result
  } catch (err) {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: {
        status: "ERROR",
        lastError: err.message,
        lastErrorAt: new Date(),
      },
    })
    throw err
  }
}

// ---------------------------------------------------------
// RESTORE ALL ACTIVE CONNECTIONS (called on server startup)
// ---------------------------------------------------------

export async function restoreAllConnections() {
  const active = await prisma.whatsAppConnection.findMany({
    where: {
      isActive: true,
      status: { in: ["CONNECTED", "RECONNECTING", "DISCONNECTED"] },
      sessionData: { not: null },
    },
  })

  console.log(`[WhatsApp] Restoring ${active.length} active connections...`)

  for (const conn of active) {
    try {
      await restoreConnection(conn.id)
    } catch (err) {
      console.error(`[WhatsApp] Failed to restore connection ${conn.name}:`, err.message)
      await prisma.whatsAppConnection.update({
        where: { id: conn.id },
        data: {
          status: "ERROR",
          lastError: err.message,
          lastErrorAt: new Date(),
        },
      })
    }
  }
}

// ---------------------------------------------------------
// RESTORE SINGLE CONNECTION
// ---------------------------------------------------------

export async function restoreConnection(connectionId) {
  const conn = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } })
  if (!conn) throw new Error("Connection not found")
  if (!conn.sessionData) throw new Error("No saved session for this connection")

  // Clean up any existing provider instance
  const existing = connections.get(connectionId)
  if (existing) {
    try { await existing.disconnect(false) } catch {}
    connections.delete(connectionId)
  }

  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: { status: "RECONNECTING" },
  })

  const provider = new BaileysProvider({ connectionId })
  connections.set(connectionId, provider)
  _registerProviderEvents(connectionId, provider)

  const result = await provider.restoreSession(conn.sessionData)

  if (result.status === "SESSION_EXPIRED") {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: {
        status: "SESSION_EXPIRED",
        sessionData: null,
        qrCode: null,
      },
    })
    return { status: "SESSION_EXPIRED", message: "Session expired — QR scan required" }
  }

  return result
}

// ---------------------------------------------------------
// REGISTER PROVIDER EVENT HANDLERS
// ---------------------------------------------------------

function _registerProviderEvents(connectionId, provider) {
  provider.on(PROVIDER_EVENTS.QR_GENERATED, async (qr) => {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { qrCode: qr, status: "QR_REQUIRED" },
    })
  })

  provider.on(PROVIDER_EVENTS.CONNECTED, async (data) => {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: {
        status: "CONNECTED",
        accountId: data.accountId,
        accountName: data.accountName,
        lastConnectedAt: new Date(),
        lastSeenAt: new Date(),
        qrCode: null,
        lastError: null,
      },
    })
    console.log(`[WhatsApp] Connection ${connectionId} connected: ${data.accountId}`)
  })

  provider.on(PROVIDER_EVENTS.SESSION_SAVED, async (encryptedSession) => {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: {
        sessionData: encryptedSession,
        lastSeenAt: new Date(),
      },
    })
  })

  provider.on(PROVIDER_EVENTS.DISCONNECTED, async (data) => {
    const conn = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } })
    if (conn && conn.status !== "DISABLED" && conn.status !== "DISCONNECTED") {
      await prisma.whatsAppConnection.update({
        where: { id: connectionId },
        data: {
          status: "DISCONNECTED",
          lastSeenAt: new Date(),
        },
      })
    }
    console.log(`[WhatsApp] Connection ${connectionId} disconnected: ${data.reason}`)
  })

  provider.on(PROVIDER_EVENTS.SESSION_EXPIRED, async () => {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: {
        status: "SESSION_EXPIRED",
        sessionData: null,
        qrCode: null,
      },
    })
    console.log(`[WhatsApp] Connection ${connectionId} session expired`)
  })

  provider.on(PROVIDER_EVENTS.CONNECTION_UPDATE, async (data) => {
    if (data.status === "reconnecting") {
      await prisma.whatsAppConnection.update({
        where: { id: connectionId },
        data: { status: "RECONNECTING" },
      })
    }
  })

  provider.on(PROVIDER_EVENTS.ERROR, async (err) => {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: {
        status: "ERROR",
        lastError: err.message,
        lastErrorAt: new Date(),
      },
    })
    console.error(`[WhatsApp] Connection ${connectionId} error:`, err.message)
  })

  provider.on(PROVIDER_EVENTS.MESSAGE_RECEIVED, async (data) => {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { lastMessageAt: new Date(), lastSeenAt: new Date() },
    })
  })
}

// ---------------------------------------------------------
// DISCONNECT / LOGOUT
// ---------------------------------------------------------

export async function disconnectConnection(connectionId, destroy = false) {
  const provider = connections.get(connectionId)
  if (provider) {
    await provider.disconnect(destroy)
    connections.delete(connectionId)
  }

  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: {
      status: destroy ? "SESSION_EXPIRED" : "DISCONNECTED",
      sessionData: destroy ? null : undefined,
      qrCode: null,
      lastSeenAt: new Date(),
    },
  })
}

// ---------------------------------------------------------
// RECONNECT
// ---------------------------------------------------------

export async function reconnectConnection(connectionId) {
  const conn = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } })
  if (!conn) throw new Error("Connection not found")

  // Clean up any existing provider instance first
  const existing = connections.get(connectionId)
  if (existing) {
    try { await existing.disconnect(false) } catch {}
    connections.delete(connectionId)
  }

  if (conn.sessionData) {
    return restoreConnection(connectionId)
  } else {
    // No session — start fresh with QR
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { status: "CONNECTING", qrCode: null, lastError: null },
    })
    return startConnection(connectionId, conn.name, conn.createdBy)
  }
}

// ---------------------------------------------------------
// HEALTH CHECK
// ---------------------------------------------------------

export async function healthCheck(connectionId) {
  const conn = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } })
  if (!conn) throw new Error("Connection not found")

  const provider = connections.get(connectionId)
  const providerStatus = provider?.getStatus() || { connected: false }

  // Update heartbeat
  if (providerStatus.connected) {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { lastHeartbeatAt: new Date() },
    })
  }

  return {
    connectionId,
    name: conn.name,
    status: conn.status,
    connected: providerStatus.connected,
    accountId: conn.accountId,
    lastConnectedAt: conn.lastConnectedAt,
    lastSeenAt: conn.lastSeenAt,
    lastMessageAt: conn.lastMessageAt,
    lastHeartbeatAt: conn.lastHeartbeatAt || providerStatus.connected ? new Date() : null,
    messagesSent: conn.messagesSent,
    messagesDelivered: conn.messagesDelivered,
    messagesFailed: conn.messagesFailed,
    messagesQueued: conn.messagesQueued,
    lastError: conn.lastError,
    autoReconnect: conn.autoReconnect,
  }
}

// ---------------------------------------------------------
// HEARTBEAT MONITOR (called periodically)
// ---------------------------------------------------------

export async function heartbeatMonitor() {
  const active = await prisma.whatsAppConnection.findMany({
    where: { isActive: true, status: "CONNECTED" },
  })

  for (const conn of active) {
    const provider = connections.get(conn.id)
    if (provider) {
      const status = provider.getStatus()
      if (!status.connected) {
        // Connection dropped but DB says CONNECTED — attempt reconnect
        console.log(`[WhatsApp] Connection ${conn.name} appears disconnected, attempting reconnect...`)
        try {
          await reconnectConnection(conn.id)
        } catch (err) {
          console.error(`[WhatsApp] Heartbeat reconnect failed for ${conn.name}:`, err.message)
        }
      } else {
        await prisma.whatsAppConnection.update({
          where: { id: conn.id },
          data: { lastHeartbeatAt: new Date() },
        })
      }
    } else {
      // Provider not in memory — restore
      if (conn.sessionData) {
        console.log(`[WhatsApp] Connection ${conn.name} not in memory, restoring...`)
        try {
          await restoreConnection(conn.id)
        } catch (err) {
          console.error(`[WhatsApp] Heartbeat restore failed for ${conn.name}:`, err.message)
        }
      }
    }
  }
}

// ---------------------------------------------------------
// GET ALL CONNECTION STATS
// ---------------------------------------------------------

export async function getConnectionStats() {
  const connections_list = await prisma.whatsAppConnection.findMany({
    include: {
      _count: { select: { messages: true, campaigns: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return connections_list.map((c) => ({
    id: c.id,
    name: c.name,
    provider: c.provider,
    purpose: c.purpose,
    accountId: c.accountId,
    accountName: c.accountName,
    status: c.status,
    lastConnectedAt: c.lastConnectedAt,
    lastSeenAt: c.lastSeenAt,
    lastMessageAt: c.lastMessageAt,
    lastHeartbeatAt: c.lastHeartbeatAt,
    messagesSent: c.messagesSent,
    messagesDelivered: c.messagesDelivered,
    messagesFailed: c.messagesFailed,
    messagesQueued: c.messagesQueued,
    lastError: c.lastError,
    autoReconnect: c.autoReconnect,
    isActive: c.isActive,
    totalMessages: c._count.messages,
    totalCampaigns: c._count.campaigns,
  }))
}
