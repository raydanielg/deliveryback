import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import prisma from "../../prisma/client.js"
import { registerSchema, loginSchema, forgotPasswordSchema, verifyOtpSchema, resetPasswordSchema } from "./validation.js"
import { generateOtp } from "../../utils/otp.js"
import { sendOtpEmail, sendWelcomeEmail } from "./email.service.js"

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

    const user = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
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
        message: "Invalid email or password.",
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
    return res.status(200).json({
      success: true,
      data: {
        user: req.user,
      },
    })
  } catch (error) {
    next(error)
  }
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
