import { Router } from "express"
import multer from "multer"
import {
  register,
  login,
  pinLogin,
  getMe,
  getMyDetails,
  updateProfile,
  forgotPassword,
  verifyOtp,
  resetPassword,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"
import {
  loginLimiter,
  otpLimiter,
  passwordResetLimiter,
} from "../../middleware/rate-limit.js"
import { getRolePermissions, PERMISSIONS, ROLE_LABELS, ALL_ROLES } from "../../middleware/permissions.js"

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

const router = Router()


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
router.post("/register", loginLimiter, register)

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
router.post("/login", loginLimiter, login)

/**
 * @swagger
 * /api/auth/pin-login:
 *   post:
 *     summary: Staff PIN/badge login for shared warehouse scanning devices
 *     description: Authenticates warehouse/operations staff via badge code + PIN instead of email/password. Rate limited to 10 requests per 15 minutes.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [badgeCode, pin]
 *             properties:
 *               badgeCode: { type: string }
 *               pin: { type: string, minLength: 4, maxLength: 8 }
 *     responses:
 *       200:
 *         description: Login successful. Returns JWT token and user details.
 *       401:
 *         description: Invalid badge or PIN
 *       403:
 *         description: Role not eligible for PIN login, or account deactivated
 *       429:
 *         description: Too many requests - rate limit exceeded
 */
router.post("/pin-login", loginLimiter, pinLogin)

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
 * /api/auth/me/details:
 *   get:
 *     summary: Get current user full details with shipments and stats
 *     description: Returns the authenticated user's profile, all their shipments with full details, and aggregate statistics.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User details with shipments and stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { type: object }
 *                     stats:
 *                       type: object
 *                       properties:
 *                         totalShipments: { type: integer }
 *                         deliveredCount: { type: integer }
 *                         activeCount: { type: integer }
 *                         cancelledCount: { type: integer }
 *                         totalSpent: { type: number }
 *                         totalValue: { type: number }
 *                         statusBreakdown: { type: object }
 *                     shipments: { type: array, items: { type: object } }
 *       401:
 *         description: Not authenticated
 */
router.get("/me/details", authenticate, getMyDetails)

/**
 * @swagger
 * /api/auth/profile:
 *   put:
 *     summary: Update user profile (name, phone, avatar)
 *     description: Updates the authenticated user's profile. Supports multipart/form-data for avatar image upload (max 5MB).
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, description: "Full name" }
 *               phone: { type: string, description: "Phone number" }
 *               avatar: { type: string, format: binary, description: "Profile image file" }
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object, properties: { user: { type: object } } }
 *       401:
 *         description: Not authenticated
 */
router.put("/profile", authenticate, upload.single("avatar"), updateProfile)

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
router.post("/forgot-password", passwordResetLimiter, forgotPassword)

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
router.post("/reset-password", passwordResetLimiter, resetPassword)

/**
 * @swagger
 * /api/auth/me/permissions:
 *   get:
 *     summary: Get current user's permissions
 *     description: Returns the authenticated user's role and all granted permissions.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User permissions
 */
router.get("/me/permissions", authenticate, (req, res) => {
  const role = req.user.role
  res.json({
    success: true,
    data: {
      role,
      roleLabel: ROLE_LABELS[role] || role,
      permissions: getRolePermissions(role),
    },
  })
})

/**
 * @swagger
 * /api/auth/permissions/all:
 *   get:
 *     summary: Get all roles and permissions (admin only)
 *     description: Returns all available roles, their labels, and permission mappings.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All roles and permissions
 */
// The role/permission matrix is an admin view — it previously had no role gate at all.
router.get("/permissions/all", authenticate, authorizeRoles("SUPER_ADMIN"), (req, res) => {
  const rolePerms = {}
  for (const role of ALL_ROLES) {
    rolePerms[role] = {
      label: ROLE_LABELS[role],
      permissions: getRolePermissions(role),
    }
  }
  res.json({
    success: true,
    data: {
      allPermissions: Object.values(PERMISSIONS),
      roles: rolePerms,
    },
  })
})

export default router
