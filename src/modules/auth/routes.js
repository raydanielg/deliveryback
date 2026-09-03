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

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user account
 *     description: Creates a new customer or driver account. Default role is CUSTOMER. Rate limited to 10 requests per 15 minutes.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 100, description: "Full name of the user" }
 *               email: { type: string, format: email, description: "Unique email address" }
 *               password: { type: string, minLength: 8, description: "Password (min 8 characters)" }
 *               phone: { type: string, description: "Phone number in international format (e.g. +255700000000)" }
 *               role: { type: string, enum: [CUSTOMER, DRIVER], default: CUSTOMER, description: "Account role - driver app should send DRIVER" }
 *     responses:
 *       201:
 *         description: Account created successfully. Returns JWT token and user details.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 token: { type: string, description: "JWT authentication token" }
 *                 user: { type: object, properties: { id: { type: string }, name: { type: string }, email: { type: string }, role: { type: string }, phone: { type: string }, isActive: { type: boolean } } }
 *       409:
 *         description: Email already registered
 *       429:
 *         description: Too many requests - rate limit exceeded
 */
router.post("/register", authLimiter, register)

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login to existing account
 *     description: Authenticates a user and returns a JWT token. Rate limited to 10 requests per 15 minutes.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful. Returns JWT token and user details.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 token: { type: string }
 *                 user: { type: object }
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many requests - rate limit exceeded
 */
router.post("/login", authLimiter, login)

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current authenticated user profile
 *     description: Returns the profile of the currently logged-in user based on the JWT token.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 user: { type: object, properties: { id: { type: string }, name: { type: string }, email: { type: string }, role: { type: string }, phone: { type: string }, isActive: { type: boolean } } }
 *       401:
 *         description: Not authenticated - token missing or invalid
 */
router.get("/me", authenticate, getMe)

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request password reset OTP
 *     description: Sends a 6-digit OTP code to the user's email address. Rate limited to 5 requests per 15 minutes.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: OTP sent to email (if account exists)
 *       429:
 *         description: Too many OTP requests - rate limit exceeded
 */
router.post("/forgot-password", otpLimiter, forgotPassword)

/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify OTP code
 *     description: Verifies the 6-digit OTP code sent during password reset. Returns a reset token for use with /reset-password.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, format: email }
 *               otp: { type: string, description: "6-digit OTP code" }
 *     responses:
 *       200:
 *         description: OTP verified. Returns reset token.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 resetToken: { type: string, description: "Token to use with /reset-password endpoint" }
 *       400:
 *         description: Invalid or expired OTP
 *       429:
 *         description: Too many requests - rate limit exceeded
 */
router.post("/verify-otp", otpLimiter, verifyOtp)

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password with reset token
 *     description: Sets a new password using the reset token obtained from /verify-otp. Rate limited to 10 requests per 15 minutes.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resetToken, newPassword]
 *             properties:
 *               resetToken: { type: string, description: "Reset token from /verify-otp" }
 *               newPassword: { type: string, minLength: 8, description: "New password (min 8 characters)" }
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid or expired reset token
 *       429:
 *         description: Too many requests - rate limit exceeded
 */
router.post("/reset-password", authLimiter, resetPassword)

export default router
