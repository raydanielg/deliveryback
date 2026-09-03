import { Router } from "express"
import { listCarriers, createCarrier, getCarrier } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/carriers:
 *   get:
 *     summary: List all carriers
 *     description: Returns all logistics carriers/partners registered in the system.
 *     tags: [Carriers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of carriers
 */
router.get("/", listCarriers)

/**
 * @swagger
 * /api/v1/carriers:
 *   post:
 *     summary: Create a new carrier
 *     description: Registers a new logistics carrier/partner. Admin/Operations Manager only.
 *     tags: [Carriers]
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
 *               code: { type: string }
 *               contactPhone: { type: string }
 *               contactEmail: { type: string, format: email }
 *     responses:
 *       201:
 *         description: Carrier created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createCarrier)

/**
 * @swagger
 * /api/v1/carriers/{id}:
 *   get:
 *     summary: Get carrier by ID
 *     tags: [Carriers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Carrier details
 *       404:
 *         description: Carrier not found
 */
router.get("/:id", getCarrier)

export default router
