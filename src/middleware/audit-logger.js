import prisma from "../prisma/client.js"

/**
 * Log an action to the audit trail
 * @param {Object} params - { userId, action, entity, entityId, changes, req }
 */
export async function logAction({ userId, action, entity, entityId, changes, req }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action,
        entity,
        entityId: entityId || null,
        changes: changes || null,
        ipAddress: req?.ip || req?.connection?.remoteAddress || null,
        userAgent: req?.headers?.["user-agent"] || null,
      },
    })
  } catch (err) {
    console.error("Audit log error:", err.message)
  }
}

/**
 * Express middleware to automatically log important actions
 * Use on routes that modify data: PUT, PATCH, DELETE, POST
 */
export function auditMiddleware(entityName) {
  return async (req, res, next) => {
    const originalSend = res.send

    res.send = function (data) {
      // Only log successful operations
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const method = req.method
        let action = ""

        switch (method) {
          case "POST":
            action = `CREATE_${entityName.toUpperCase()}`
            break
          case "PUT":
          case "PATCH":
            action = `UPDATE_${entityName.toUpperCase()}`
            break
          case "DELETE":
            action = `DELETE_${entityName.toUpperCase()}`
            break
        }

        // Extract entity ID from params or response
        let entityId = req.params?.id
        try {
          const parsed = JSON.parse(data)
          if (parsed.data?.id) entityId = parsed.data.id
        } catch (e) {
          // Not JSON
        }

        logAction({
          userId: req.user?.id,
          action,
          entity: entityName,
          entityId,
          changes: method !== "GET" ? req.body : null,
          req,
        }).catch(() => {})
      }

      originalSend.call(this, data)
    }

    next()
  }
}

/**
 * Get audit logs with filtering
 */
export async function listAuditLogs(req, res, next) {
  try {
    const { userId, entity, action, page = 1, limit = 50, startDate, endDate } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const where = {}
    if (userId) where.userId = userId
    if (entity) where.entity = entity
    if (action) where.action = { contains: action }
    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) where.createdAt.gte = new Date(startDate)
      if (endDate) where.createdAt.lte = new Date(endDate)
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.auditLog.count({ where }),
    ])

    res.json({
      success: true,
      data: logs,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    })
  } catch (err) {
    next(err)
  }
}
