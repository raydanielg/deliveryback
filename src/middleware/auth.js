import jwt from "jsonwebtoken"
import prisma from "../prisma/client.js"
import { hasPermission, hasAnyPermission, hasAllPermissions, getRolePermissions } from "./permissions.js"

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      })
    }

    const token = authHeader.split(" ")[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        isVerified: true,
        isActive: true,
      },
    })

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found. Token invalid.",
      })
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account deactivated. Contact support.",
      })
    }

    req.user = user
    next()
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired. Please log in again.",
      })
    }

    return res.status(401).json({
      success: false,
      message: "Invalid token.",
    })
  }
}

export function authorizeRoles(...roles) {
  const allowed = roles.flat()
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated.",
      })
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions.",
      })
    }

    next()
  }
}

// Permission-based authorization — single permission
export function authorizePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated.",
      })
    }

    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        success: false,
        message: `Insufficient permissions. Required: ${permission}`,
      })
    }

    next()
  }
}

// Permission-based authorization — any of the given permissions
export function authorizeAnyPermission(...permissions) {
  const required = permissions.flat()
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated.",
      })
    }

    if (!hasAnyPermission(req.user.role, required)) {
      return res.status(403).json({
        success: false,
        message: `Insufficient permissions. Required any of: ${required.join(", ")}`,
      })
    }

    next()
  }
}

// Permission-based authorization — all of the given permissions
export function authorizeAllPermissions(...permissions) {
  const required = permissions.flat()
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated.",
      })
    }

    if (!hasAllPermissions(req.user.role, required)) {
      return res.status(403).json({
        success: false,
        message: `Insufficient permissions. Required all of: ${required.join(", ")}`,
      })
    }

    next()
  }
}

// Export permission helpers for use in controllers
export { hasPermission, hasAnyPermission, hasAllPermissions, getRolePermissions }

