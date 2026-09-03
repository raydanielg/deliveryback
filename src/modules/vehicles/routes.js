import { Router } from "express"
import { listVehicles, createVehicle, updateVehicleStatus } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/vehicles:
 *   get:
 *     summary: List all vehicles
 *     description: Returns all registered vehicles in the fleet.
 *     tags: [Vehicles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of vehicles
 */
router.get("/", listVehicles)

/**
 * @swagger
 * /api/v1/vehicles:
 *   post:
 *     summary: Register a new vehicle
 *     description: Adds a new vehicle to the fleet. Admin/Operations Manager only.
 *     tags: [Vehicles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               plateNumber: { type: string }
 *               type: { type: string, enum: [BIKE, CAR, VAN, TRUCK] }
 *               capacityKg: { type: number }
 *               carrierId: { type: string }
 *     responses:
 *       201:
 *         description: Vehicle created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createVehicle)

/**
 * @swagger
 * /api/v1/vehicles/{id}/status:
 *   patch:
 *     summary: Update vehicle status
 *     description: Updates a vehicle's operational status (ACTIVE, MAINTENANCE, RETIRED).
 *     tags: [Vehicles]
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
 *               status: { type: string, enum: [ACTIVE, MAINTENANCE, RETIRED] }
 *     responses:
 *       200:
 *         description: Vehicle status updated
 *       404:
 *         description: Vehicle not found
 */
router.patch("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateVehicleStatus)

export default router
