import { Router } from "express"
import {
  listSurgePricings, createSurgePricing, updateSurgePricing,
  deleteSurgePricing, toggleSurgePricing,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/surge-pricing:
 *   get:
 *     summary: List all surge pricing rules
 *     description: Returns all surge pricing rules including time-based multipliers for peak hours, weekends, and holidays.
 *     tags: [Surge Pricing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of surge pricing rules
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object, properties: { id: { type: string }, name: { type: string }, multiplier: { type: number }, isActive: { type: boolean }, timeSlots: { type: array } } } }
 */
router.get("/", listSurgePricings)

/**
 * @swagger
 * /api/v1/surge-pricing:
 *   post:
 *     summary: Create a surge pricing rule
 *     description: Creates a new surge pricing rule with time slots for peak period fare multiplication. Admin/Operations Manager only.
 *     tags: [Surge Pricing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, multiplier]
 *             properties:
 *               name: { type: string, description: "e.g. 'Peak Hours', 'Weekend Surge', 'Holiday Surge'" }
 *               multiplier: { type: number, description: "Price multiplier (e.g. 1.5 = 50% surcharge)" }
 *               isActive: { type: boolean, default: true }
 *               timeSlots: { type: array, items: { type: object, properties: { dayOfWeek: { type: integer, description: "0-6 (Sunday-Saturday)" }, startTime: { type: string, description: "HH:mm format" }, endTime: { type: string, description: "HH:mm format" } } } }
 *     responses:
 *       201:
 *         description: Surge pricing rule created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createSurgePricing)

/**
 * @swagger
 * /api/v1/surge-pricing/{id}:
 *   put:
 *     summary: Update a surge pricing rule
 *     tags: [Surge Pricing]
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
 *               multiplier: { type: number }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Surge pricing rule updated
 *       404:
 *         description: Rule not found
 */
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateSurgePricing)

/**
 * @swagger
 * /api/v1/surge-pricing/{id}:
 *   delete:
 *     summary: Delete a surge pricing rule (super admin only)
 *     tags: [Surge Pricing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Rule deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteSurgePricing)

/**
 * @swagger
 * /api/v1/surge-pricing/{id}/toggle:
 *   patch:
 *     summary: Toggle surge pricing rule active status
 *     tags: [Surge Pricing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Rule toggled
 *       404:
 *         description: Rule not found
 */
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleSurgePricing)

export default router
