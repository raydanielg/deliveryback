import jwt from "jsonwebtoken"
import prisma from "../prisma/client.js"

// Driver-specific authentication: verifies the JWT and loads the Driver record
// associated with the user. Sets req.driver for dispatch endpoints.
// Falls back to the standard authenticate middleware if the user is not a driver
// (e.g. admin testing), but req.driver will be null in that case.
export async function driverAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Driver authentication required.",
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
        isActive: true,
      },
    })

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found.",
      })
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account deactivated.",
      })
    }

    // Load driver record
    const driver = await prisma.driver.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        status: true,
        isOnline: true,
        isActive: true,
        approvalStatus: true,
        licenseExpiry: true,
        currentLatitude: true,
        currentLongitude: true,
      },
    })

    if (!driver) {
      // Allow admin/ops roles to access driver endpoints for testing
      if (["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(user.role)) {
        req.user = user
        req.driver = null
        return next()
      }
      return res.status(403).json({
        success: false,
        message: "No driver profile found for this account.",
      })
    }

    if (!driver.isActive) {
      return res.status(403).json({
        success: false,
        message: "Driver account is inactive.",
      })
    }

    req.user = user
    req.driver = driver
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
