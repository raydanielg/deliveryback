import { Router } from "express"
import rateLimit from "express-rate-limit"
import {
  register,
  login,
  getMe,
  forgotPassword,
  verifyOtp,
  resetPassword,
} from "./controller.js"
import { authenticate } from "../../middleware/auth.js"

const router = Router()

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: "Too many OTP requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

router.post("/register", authLimiter, register)
router.post("/login", authLimiter, login)
router.get("/me", authenticate, getMe)
router.post("/forgot-password", otpLimiter, forgotPassword)
router.post("/verify-otp", otpLimiter, verifyOtp)
router.post("/reset-password", authLimiter, resetPassword)

export default router
