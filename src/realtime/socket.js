import { Server } from "socket.io"
import jwt from "jsonwebtoken"
import prisma from "../prisma/client.js"

let io = null

// Attached once, right after app.listen(...) in server.js. JWT-authenticated handshake
// reuses the exact same secret/verification as middleware/auth.js so a client's existing
// REST bearer token also works for the socket connection — no separate credential.
export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL || "*", credentials: true },
  })

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (!token) return next(new Error("No token provided"))

      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, role: true, isActive: true },
      })
      if (!user || !user.isActive) return next(new Error("Invalid or inactive user"))

      socket.user = user
      next()
    } catch (err) {
      next(new Error("Authentication failed"))
    }
  })

  io.on("connection", (socket) => {
    socket.join(`user:${socket.user.id}`)
    socket.join(`role:${socket.user.role}`)

    const subscribable = ["shipment", "box", "trip", "station"]
    for (const kind of subscribable) {
      socket.on(`subscribe:${kind}`, (id) => id && socket.join(`${kind}:${id}`))
      socket.on(`unsubscribe:${kind}`, (id) => id && socket.leave(`${kind}:${id}`))
    }
  })

  return io
}

export function getIO() {
  return io
}

function emit(room, event, payload) {
  // No-op until initRealtime runs (e.g. scripts/tests that import a controller directly) —
  // callers never need to check whether sockets are wired up.
  if (!io) return
  io.to(room).emit(event, payload)
}

export const emitToShipment = (id, event, payload) => emit(`shipment:${id}`, event, payload)
export const emitToBox = (id, event, payload) => emit(`box:${id}`, event, payload)
export const emitToTrip = (id, event, payload) => emit(`trip:${id}`, event, payload)
export const emitToStation = (id, event, payload) => emit(`station:${id}`, event, payload)
export const emitToUser = (id, event, payload) => emit(`user:${id}`, event, payload)
export const emitToRole = (role, event, payload) => emit(`role:${role}`, event, payload)
