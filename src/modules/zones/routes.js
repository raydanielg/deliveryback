import { Router } from "express"
import {
  listZones, getZone, createZone,
  updateZone, deleteZone, toggleZone,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/zones:
 *   get:
 *     summary: List all zones
 *     tags: [Zones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: activeOnly
 *         schema: { type: string, enum: ["true", "false"] }
 *         description: Filter only active zones
 *       - in: query
 *         name: countryId
 *         schema: { type: string }
 *         description: Filter by country ID
 *       - in: query
 *         name: regionId
 *         schema: { type: string }
 *         description: Filter by region ID
 *       - in: query
 *         name: cityId
 *         schema: { type: string }
 *         description: Filter by city ID
 *     responses:
 *       200:
 *         description: List of zones
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get("/", listZones)

/**
 * @swagger
 * /api/v1/zones/{id}:
 *   get:
 *     summary: Get zone by ID
 *     tags: [Zones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Zone details
 *       404:
 *         description: Zone not found
 */
router.get("/:id", getZone)

/**
 * @swagger
 * /api/v1/zones:
 *   post:
 *     summary: Create a new zone
 *     tags: [Zones]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, countryId]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 100 }
 *               code: { type: string, maxLength: 20 }
 *               countryId: { type: string }
 *               regionId: { type: string }
 *               cityId: { type: string }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Zone created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createZone)

/**
 * @swagger
 * /api/v1/zones/{id}:
 *   put:
 *     summary: Update a zone
 *     tags: [Zones]
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
 *               code: { type: string }
 *               countryId: { type: string }
 *               regionId: { type: string }
 *               cityId: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Zone updated
 *       404:
 *         description: Zone not found
 */
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateZone)

/**
 * @swagger
 * /api/v1/zones/{id}:
 *   delete:
 *     summary: Delete a zone
 *     tags: [Zones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Zone deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteZone)

/**
 * @swagger
 * /api/v1/zones/{id}/toggle:
 *   patch:
 *     summary: Toggle zone active status
 *     tags: [Zones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Zone toggled
 *       404:
 *         description: Zone not found
 */
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleZone)

export default router
