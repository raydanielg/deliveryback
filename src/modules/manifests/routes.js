import { Router } from "express"
import { listManifests, createManifest, updateManifestStatus } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/manifests:
 *   get:
 *     summary: List all manifests
 *     description: Returns shipment manifests used for grouping multiple shipments for a single trip/route.
 *     tags: [Manifests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of manifests
 */
router.get("/", listManifests)

/**
 * @swagger
 * /api/v1/manifests:
 *   post:
 *     summary: Create a manifest
 *     description: Creates a new manifest grouping multiple shipments. Admin/Operations/Dispatcher only.
 *     tags: [Manifests]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               driverId: { type: string }
 *               vehicleId: { type: string }
 *               shipmentIds: { type: array, items: { type: string } }
 *               routeId: { type: string }
 *     responses:
 *       201:
 *         description: Manifest created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), createManifest)

/**
 * @swagger
 * /api/v1/manifests/{id}/status:
 *   patch:
 *     summary: Update manifest status
 *     description: Updates manifest status (DRAFT, DISPATCHED, IN_TRANSIT, COMPLETED, CANCELLED).
 *     tags: [Manifests]
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
 *               status: { type: string, enum: [DRAFT, DISPATCHED, IN_TRANSIT, COMPLETED, CANCELLED] }
 *     responses:
 *       200:
 *         description: Manifest status updated
 *       404:
 *         description: Manifest not found
 */
router.patch("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), updateManifestStatus)

export default router
