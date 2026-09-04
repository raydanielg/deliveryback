import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import path from "path"
import fs from "fs/promises"
import prisma from "../../prisma/client.js"
import { registerSchema, loginSchema, forgotPasswordSchema, verifyOtpSchema, resetPasswordSchema } from "./validation.js"
import { generateOtp } from "../../utils/otp.js"
import { sendOtpEmail, sendWelcomeEmail } from "./email.service.js"
import { sendOtpSms, sendSms } from "./sms.service.js"
import { createNotification } from "../notifications/controller.js"

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  })
}

function userResponse(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    avatar: user.avatar,
    isVerified: user.isVerified,
    isActive: user.isActive,
  }
}

export async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body)

    const existing = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      })
    }

    const hashedPassword = await bcrypt.hash(data.password, 12)

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        password: hashedPassword,
        role: data.role,
      },
    })

    try {
      await sendWelcomeEmail(user.email, user.name)
    } catch (emailErr) {
      console.warn("Welcome email failed:", emailErr.message)
    }

    if (user.phone) {
      try {
        const otp = generateOtp()
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000)
        await prisma.user.update({
          where: { id: user.id },
          data: { resetOtp: otp, resetOtpExp: otpExpiry },
        })
        await sendOtpSms(user.phone, otp, user.name)
      } catch (smsErr) {
        console.warn("Welcome SMS failed:", smsErr.message)
      }
    }

    try {
      await createNotification(
        user.id,
        "WELCOME",
        "Welcome to Xerin Express!",
        `Hello ${user.name}, your account has been created successfully. You can now create shipments, track packages, and manage your deliveries.`,
        { role: user.role }
      )
    } catch (notifErr) {
      console.warn("Welcome notification failed:", notifErr.message)
    }

    const token = signToken(user.id)

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      data: {
        user: userResponse(user),
        token,
      },
    })
  } catch (error) {
    next(error)
  }
}

export async function login(req, res, next) {
  try {
    const data = loginSchema.parse(req.body)

    const loginValue = (data.login || data.email || "").trim()
    const isEmail = loginValue.includes("@")

    const user = isEmail
      ? await prisma.user.findUnique({ where: { email: loginValue.toLowerCase() } })
      : await prisma.user.findUnique({ where: { phone: loginValue } })

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email/phone or password.",
      })
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account deactivated. Contact support.",
      })
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password)

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email/phone or password.",
      })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const token = signToken(user.id)

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      data: {
        user: userResponse(user),
        token,
      },
    })
  } catch (error) {
    next(error)
  }
}

export async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        avatar: true, isVerified: true, isActive: true,
      },
    })
    if (!user) return res.status(404).json({ success: false, message: "User not found" })
    return res.status(200).json({
      success: true,
      data: { user },
    })
  } catch (error) {
    next(error)
  }
}

export async function updateProfile(req, res, next) {
  try {
    const { name, phone } = req.body
    const data = {}
    if (name) data.name = name
    if (phone) data.phone = phone

    if (req.file) {
      const ext = req.file.originalname.split(".").pop() || "jpg"
      const filename = `avatar-${req.user.id}-${Date.now()}.${ext}`
      const uploadsDir = path.join(process.cwd(), "uploads", "avatars")
      await fs.mkdir(uploadsDir, { recursive: true })
      await fs.writeFile(path.join(uploadsDir, filename), req.file.buffer)
      data.avatar = `/uploads/avatars/${filename}`
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        avatar: true, isVerified: true, isActive: true,
      },
    })

    res.json({ success: true, data: { user }, message: "Profile updated successfully" })
  } catch (err) { next(err) }
}

export async function forgotPassword(req, res, next) {
  try {
    const data = forgotPasswordSchema.parse(req.body)

    const user = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account with that email exists, a verification code has been sent.",
      })
    }

    const otp = generateOtp()
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetOtp: otp,
        resetOtpExp: otpExpiry,
      },
    })

    try {
      await sendOtpEmail(user.email, otp, user.name)
    } catch (emailErr) {
      console.error("OTP email failed:", emailErr.message)
      return res.status(500).json({
        success: false,
        message: "Failed to send verification code. Please try again.",
      })
    }

    if (user.phone) {
      try {
        await sendOtpSms(user.phone, otp, user.name)
      } catch (smsErr) {
        console.warn("OTP SMS failed:", smsErr.message)
      }
    }

    return res.status(200).json({
      success: true,
      message: "If an account with that email exists, a verification code has been sent.",
    })
  } catch (error) {
    next(error)
  }
}

export async function verifyOtp(req, res, next) {
  try {
    const data = verifyOtpSchema.parse(req.body)

    const user = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (!user || !user.resetOtp || !user.resetOtpExp) {
      return res.status(400).json({
        success: false,
        message: "No password reset request found. Please request a new code.",
      })
    }

    if (user.resetOtpExp < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired. Please request a new one.",
      })
    }

    if (user.resetOtp !== data.otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code.",
      })
    }

    return res.status(200).json({
      success: true,
      message: "Email verified successfully. You can now reset your password.",
    })
  } catch (error) {
    next(error)
  }
}

export async function resetPassword(req, res, next) {
  try {
    const data = resetPasswordSchema.parse(req.body)

    const user = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (!user || !user.resetOtp || !user.resetOtpExp) {
      return res.status(400).json({
        success: false,
        message: "No password reset request found. Please request a new code.",
      })
    }

    if (user.resetOtpExp < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired. Please request a new one.",
      })
    }

    if (user.resetOtp !== data.otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code.",
      })
    }

    const hashedPassword = await bcrypt.hash(data.password, 12)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetOtp: null,
        resetOtpExp: null,
      },
    })

    return res.status(200).json({
      success: true,
      message: "Password reset successfully. You can now log in with your new password.",
    })
  } catch (error) {
    next(error)
  }
}

export async function getMyDetails(req, res, next) {
  try {
    const userId = req.user.id

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        avatar: true, isVerified: true, isActive: true, createdAt: true, updatedAt: true,
      },
    })

    if (!user) return res.status(404).json({ success: false, message: "User not found" })

    const [shipments, stats] = await Promise.all([
      prisma.shipment.findMany({
        where: { createdById: userId },
        include: {
          fromAddress: { select: { city: true, country: true, address: true } },
          toAddress: { select: { city: true, country: true, address: true } },
          driver: { include: { user: { select: { name: true, phone: true, avatar: true } } } },
          vehicle: { select: { plateNumber: true, type: true } },
          carrier: { select: { name: true } },
          packages: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      Promise.all([
        prisma.shipment.count({ where: { createdById: userId } }),
        prisma.shipment.count({ where: { createdById: userId, status: "DELIVERED" } }),
        prisma.shipment.count({
          where: {
            createdById: userId,
            status: { in: ["PENDING", "ACCEPTED", "BOOKED", "AWAITING_PICKUP", "DRIVER_ASSIGNED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "ONGOING", "OUT_FOR_PICKUP"] },
          },
        }),
        prisma.shipment.count({ where: { createdById: userId, status: "CANCELLED" } }),
        prisma.shipment.aggregate({
          where: { createdById: userId, paymentStatus: "PAID" },
          _sum: { totalAmount: true },
        }),
        prisma.shipment.aggregate({
          where: { createdById: userId },
          _sum: { totalAmount: true },
        }),
      ]),
    ])

    const [totalShipments, deliveredCount, activeCount, cancelledCount, totalSpent, totalValue] = stats

    const statusBreakdown = {}
    for (const s of shipments) {
      statusBreakdown[s.status] = (statusBreakdown[s.status] || 0) + 1
    }

    res.json({
      success: true,
      data: {
        user,
        stats: {
          totalShipments,
          deliveredCount,
          activeCount,
          cancelledCount,
          totalSpent: totalSpent._sum.totalAmount || 0,
          totalValue: totalValue._sum.totalAmount || 0,
          statusBreakdown,
        },
        shipments,
      },
    })
  } catch (error) {
    next(error)
  }
}
