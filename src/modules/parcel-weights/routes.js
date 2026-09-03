import { Router } from "express"
import {
  listParcelWeights, createParcelWeight, updateParcelWeight,
  deleteParcelWeight, toggleParcelWeight,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/parcel-weights:
 *   get:
 *     summary: List all parcel weight tiers
 *     description: Returns all weight tiers (e.g. 0-1kg, 1-5kg, 5-10kg) used for fare calculation.
 *     tags: [Parcel Weights]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of weight tiers
 */
router.get("/", listParcelWeights)

/**
 * @swagger
 * /api/v1/parcel-weights:
 *   post:
 *     summary: Create a weight tier
 *     description: Creates a new weight tier for parcel fare calculation. Admin/Operations Manager only.
 *     tags: [Parcel Weights]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [minWeight, maxWeight]
 *             properties:
 *               minWeight: { type: number, description: "Minimum weight in kg" }
 *               maxWeight: { type: number, description: "Maximum weight in kg" }
 *               label: { type: string, description: "Display label (e.g. 'Light', 'Medium', 'Heavy')" }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Weight tier created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createParcelWeight)

/**
 * @swagger
 * /api/v1/parcel-weights/{id}:
 *   put:
 *     summary: Update a weight tier
 *     tags: [Parcel Weights]
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
 *               minWeight: { type: number }
 *               maxWeight: { type: number }
 *               label: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Weight tier updated
 *       404:
 *         description: Weight tier not found
 */
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateParcelWeight)

/**
 * @swagger
 * /api/v1/parcel-weights/{id}:
 *   delete:
 *     summary: Delete a weight tier (super admin only)
 *     tags: [Parcel Weights]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Weight tier deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteParcelWeight)

/**
 * @swagger
 * /api/v1/parcel-weights/{id}/toggle:
 *   patch:
 *     summary: Toggle weight tier active status
 *     tags: [Parcel Weights]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Weight tier toggled
 *       404:
 *         description: Weight tier not found
 */
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleParcelWeight)

export default router
