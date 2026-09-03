import { Router } from "express"
import {
  listParcelFares, createParcelFare, updateParcelFare, deleteParcelFare,
  listParcelFareWeights, createParcelFareWeight, updateParcelFareWeight, deleteParcelFareWeight,
  estimateParcelFare,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/parcel-fares/estimate:
 *   get:
 *     summary: Estimate parcel fare
 *     description: Calculates the estimated fare for a parcel based on category, weight, and distance. Available to all authenticated users.
 *     tags: [Parcel Fares]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: categoryId
 *         required: true
 *         schema: { type: string }
 *         description: Parcel category ID
 *       - in: query
 *         name: weightKg
 *         required: true
 *         schema: { type: number }
 *         description: Weight in kilograms
 *       - in: query
 *         name: distanceKm
 *         schema: { type: number }
 *         description: Distance in kilometers (if applicable)
 *     responses:
 *       200:
 *         description: Estimated fare
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object, properties: { baseFare: { type: number }, weightCharge: { type: number }, total: { type: number }, currency: { type: string } } }
 */
router.get("/estimate", estimateParcelFare)

/**
 * @swagger
 * /api/v1/parcel-fares/fares:
 *   get:
 *     summary: List all parcel fares
 *     description: Returns all configured parcel fares for different categories and zones.
 *     tags: [Parcel Fares]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of parcel fares
 */
router.get("/fares", listParcelFares)

/**
 * @swagger
 * /api/v1/parcel-fares/fares:
 *   post:
 *     summary: Create a parcel fare
 *     description: Creates a new fare rule for a specific category and zone. Admin/Operations Manager only.
 *     tags: [Parcel Fares]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               categoryId: { type: string }
 *               zoneId: { type: string }
 *               basePrice: { type: number }
 *               perKmRate: { type: number }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Fare created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/fares", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createParcelFare)

/**
 * @swagger
 * /api/v1/parcel-fares/fares/{id}:
 *   put:
 *     summary: Update a parcel fare
 *     tags: [Parcel Fares]
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
 *               basePrice: { type: number }
 *               perKmRate: { type: number }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Fare updated
 *       404:
 *         description: Fare not found
 */
router.put("/fares/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateParcelFare)

/**
 * @swagger
 * /api/v1/parcel-fares/fares/{id}:
 *   delete:
 *     summary: Delete a parcel fare (super admin only)
 *     tags: [Parcel Fares]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Fare deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/fares/:id", authorizeRoles("SUPER_ADMIN"), deleteParcelFare)

/**
 * @swagger
 * /api/v1/parcel-fares/fare-weights:
 *   get:
 *     summary: List all fare-weight combinations
 *     description: Returns all fare-weight tier combinations used for multi-dimensional fare calculation.
 *     tags: [Parcel Fares]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of fare-weight combinations
 */
router.get("/fare-weights", listParcelFareWeights)

/**
 * @swagger
 * /api/v1/parcel-fares/fare-weights:
 *   post:
 *     summary: Create a fare-weight combination
 *     description: Links a fare to a weight tier with a specific price multiplier or fixed amount.
 *     tags: [Parcel Fares]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fareId: { type: string }
 *               weightId: { type: string }
 *               price: { type: number }
 *     responses:
 *       201:
 *         description: Fare-weight created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/fare-weights", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createParcelFareWeight)

/**
 * @swagger
 * /api/v1/parcel-fares/fare-weights/{id}:
 *   put:
 *     summary: Update a fare-weight combination
 *     tags: [Parcel Fares]
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
 *               price: { type: number }
 *     responses:
 *       200:
 *         description: Fare-weight updated
 *       404:
 *         description: Fare-weight not found
 */
router.put("/fare-weights/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateParcelFareWeight)

/**
 * @swagger
 * /api/v1/parcel-fares/fare-weights/{id}:
 *   delete:
 *     summary: Delete a fare-weight combination (super admin only)
 *     tags: [Parcel Fares]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Fare-weight deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/fare-weights/:id", authorizeRoles("SUPER_ADMIN"), deleteParcelFareWeight)

export default router
