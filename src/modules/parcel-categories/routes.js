import { Router } from "express"
import {
  listParcelCategories, getParcelCategory, createParcelCategory,
  updateParcelCategory, deleteParcelCategory, toggleParcelCategory,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/parcel-categories:
 *   get:
 *     summary: List all parcel categories
 *     description: Returns all parcel categories (e.g. Documents, Electronics, Food, Clothing) available for shipment creation.
 *     tags: [Parcel Categories]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of parcel categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object, properties: { id: { type: string }, name: { type: string }, description: { type: string }, icon: { type: string }, isActive: { type: boolean } } } }
 */
router.get("/", listParcelCategories)

/**
 * @swagger
 * /api/v1/parcel-categories/{id}:
 *   get:
 *     summary: Get parcel category by ID
 *     tags: [Parcel Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Category details
 *       404:
 *         description: Category not found
 */
router.get("/:id", getParcelCategory)

/**
 * @swagger
 * /api/v1/parcel-categories:
 *   post:
 *     summary: Create a parcel category
 *     description: Creates a new parcel category. Admin/Operations Manager only.
 *     tags: [Parcel Categories]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 100 }
 *               description: { type: string }
 *               icon: { type: string, description: "Icon name or URL" }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Category created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createParcelCategory)

/**
 * @swagger
 * /api/v1/parcel-categories/{id}:
 *   put:
 *     summary: Update a parcel category
 *     tags: [Parcel Categories]
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
 *               description: { type: string }
 *               icon: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Category updated
 *       404:
 *         description: Category not found
 */
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateParcelCategory)

/**
 * @swagger
 * /api/v1/parcel-categories/{id}:
 *   delete:
 *     summary: Delete a parcel category (super admin only)
 *     tags: [Parcel Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Category deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteParcelCategory)

/**
 * @swagger
 * /api/v1/parcel-categories/{id}/toggle:
 *   patch:
 *     summary: Toggle category active status
 *     tags: [Parcel Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Category toggled
 *       404:
 *         description: Category not found
 */
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleParcelCategory)

export default router
