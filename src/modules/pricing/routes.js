import { Router } from "express"
import {
  listPricingRules, createPricingRule, updatePricingRule,
  deletePricingRule, togglePricingRule,
  listSurcharges, createSurcharge, deleteSurcharge,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/pricing/rules:
 *   get:
 *     summary: List all pricing rules
 *     description: Returns all pricing rules configured for shipment cost calculation.
 *     tags: [Pricing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pricing rules
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 */
router.get("/rules", listPricingRules)

/**
 * @swagger
 * /api/v1/pricing/rules:
 *   post:
 *     summary: Create a pricing rule
 *     description: Creates a new pricing rule for shipment cost calculation. Admin/Operations Manager only.
 *     tags: [Pricing]
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
 *               basePrice: { type: number }
 *               perKmRate: { type: number }
 *               perKgRate: { type: number }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Pricing rule created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/rules", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createPricingRule)

/**
 * @swagger
 * /api/v1/pricing/rules/{id}:
 *   put:
 *     summary: Update a pricing rule
 *     tags: [Pricing]
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
 *               basePrice: { type: number }
 *               perKmRate: { type: number }
 *               perKgRate: { type: number }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Pricing rule updated
 *       404:
 *         description: Rule not found
 */
router.put("/rules/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updatePricingRule)

/**
 * @swagger
 * /api/v1/pricing/rules/{id}:
 *   delete:
 *     summary: Delete a pricing rule (super admin only)
 *     tags: [Pricing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Pricing rule deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/rules/:id", authorizeRoles("SUPER_ADMIN"), deletePricingRule)

/**
 * @swagger
 * /api/v1/pricing/rules/{id}/toggle:
 *   patch:
 *     summary: Toggle pricing rule active status
 *     tags: [Pricing]
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
router.patch("/rules/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), togglePricingRule)

/**
 * @swagger
 * /api/v1/pricing/surcharges:
 *   get:
 *     summary: List all surcharges
 *     description: Returns all configured surcharges (fuel surcharge, peak season, etc.)
 *     tags: [Pricing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of surcharges
 */
router.get("/surcharges", listSurcharges)

/**
 * @swagger
 * /api/v1/pricing/surcharges:
 *   post:
 *     summary: Create a surcharge
 *     description: Creates a new surcharge rule. Admin/Operations Manager only.
 *     tags: [Pricing]
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
 *               percentage: { type: number }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Surcharge created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/surcharges", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createSurcharge)

/**
 * @swagger
 * /api/v1/pricing/surcharges/{id}:
 *   delete:
 *     summary: Delete a surcharge (super admin only)
 *     tags: [Pricing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Surcharge deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/surcharges/:id", authorizeRoles("SUPER_ADMIN"), deleteSurcharge)

export default router
