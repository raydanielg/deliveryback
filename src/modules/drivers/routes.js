import { Router } from "express"
import { listDrivers, createDriver, updateDriverStatus } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/drivers:
 *   get:
 *     summary: List all drivers
 *     description: Returns a list of all registered drivers with their status and vehicle info.
 *     tags: [Drivers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of drivers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 */
router.get("/", listDrivers)

/**
 * @swagger
 * /api/v1/drivers:
 *   post:
 *     summary: Create a new driver profile
 *     description: Creates a new driver profile. Admin/Operations Manager only.
 *     tags: [Drivers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               licenseNumber: { type: string }
 *               vehicleId: { type: string }
 *     responses:
 *       201:
 *         description: Driver created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createDriver)

/**
 * @swagger
 * /api/v1/drivers/{id}/status:
 *   patch:
 *     summary: Update driver status
 *     description: Updates a driver's availability status (e.g. AVAILABLE, BUSY, OFFLINE).
 *     tags: [Drivers]
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
 *               status: { type: string, enum: [AVAILABLE, BUSY, OFFLINE, ON_LEAVE] }
 *     responses:
 *       200:
 *         description: Driver status updated
 *       404:
 *         description: Driver not found
 */
router.patch("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), updateDriverStatus)

export default router
