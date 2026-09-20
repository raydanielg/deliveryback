import { Router } from "express"
import {
  listUsers, getUser, createUser, updateUser, deleteUser,
  toggleUserActive, changeUserRole, changePassword, setStaffCredentials, getUserStats,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     summary: List all users (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: string, enum: ["true", "false"] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of users with pagination
 */
router.get("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), listUsers)

/**
 * @swagger
 * /api/v1/users/stats:
 *   get:
 *     summary: Get user statistics (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User statistics
 */
router.get("/stats", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), getUserStats)

/**
 * @swagger
 * /api/v1/users/{id}:
 *   get:
 *     summary: Get user by ID (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User details
 *       404:
 *         description: User not found
 */
router.get("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), getUser)

/**
 * @swagger
 * /api/v1/users:
 *   post:
 *     summary: Create a new user (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, role]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               password: { type: string, minLength: 8 }
 *               role: { type: string, enum: [SUPER_ADMIN, OPERATIONS_MANAGER, FINANCE, WAREHOUSE_MANAGER, BRANCH_MANAGER, AGENT, CUSTOMER, DRIVER] }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: User created
 *       409:
 *         description: Email already in use
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createUser)

/**
 * @swagger
 * /api/v1/users/{id}:
 *   put:
 *     summary: Update user (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               role: { type: string }
 *               isActive: { type: boolean }
 *               avatar: { type: string, format: uri }
 *     responses:
 *       200:
 *         description: User updated
 */
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateUser)

/**
 * @swagger
 * /api/v1/users/{id}:
 *   delete:
 *     summary: Delete user (super admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User deleted
 *       400:
 *         description: Cannot delete own account
 */
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteUser)

/**
 * @swagger
 * /api/v1/users/{id}/toggle:
 *   patch:
 *     summary: Toggle user active status (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User toggled
 */
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleUserActive)

/**
 * @swagger
 * /api/v1/users/{id}/role:
 *   patch:
 *     summary: Change user role (super admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [SUPER_ADMIN, OPERATIONS_MANAGER, FINANCE, WAREHOUSE_MANAGER, BRANCH_MANAGER, AGENT, CUSTOMER, DRIVER] }
 *     responses:
 *       200:
 *         description: Role updated
 */
router.patch("/:id/role", authorizeRoles("SUPER_ADMIN"), changeUserRole)

/**
 * @swagger
 * /api/v1/users/{id}/password:
 *   put:
 *     summary: Change user password (self or admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Current password incorrect
 */
router.put("/:id/password", changePassword)

/**
 * @swagger
 * /api/v1/users/{id}/staff-credentials:
 *   patch:
 *     summary: Set a staff member's PIN/badge login for shared warehouse scanning devices (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *         description: Credentials set
 *       409:
 *         description: Badge code already assigned to another user
 */
router.patch("/:id/staff-credentials", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), setStaffCredentials)

export default router
