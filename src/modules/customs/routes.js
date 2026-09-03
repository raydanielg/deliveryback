import { Router } from "express"
import { getCustomsDeclaration, createCustomsDeclaration, updateCustomsStatus } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/customs/{shipmentId}:
 *   get:
 *     summary: Get customs declaration for a shipment
 *     description: Returns the customs declaration document for international shipments.
 *     tags: [Customs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Customs declaration details
 *       404:
 *         description: No customs declaration found for this shipment
 */
router.get("/:shipmentId", getCustomsDeclaration)

/**
 * @swagger
 * /api/v1/customs:
 *   post:
 *     summary: Create a customs declaration
 *     description: Creates a customs declaration for an international shipment including item details, value, and HS codes.
 *     tags: [Customs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shipmentId: { type: string }
 *               items: { type: array, items: { type: object, properties: { description: { type: string }, quantity: { type: integer }, value: { type: number }, hsCode: { type: string }, originCountry: { type: string } } } }
 *               totalValue: { type: number }
 *               currency: { type: string }
 *     responses:
 *       201:
 *         description: Customs declaration created
 */
router.post("/", createCustomsDeclaration)

/**
 * @swagger
 * /api/v1/customs/{id}/status:
 *   put:
 *     summary: Update customs declaration status
 *     description: Updates the customs clearance status. Admin/Operations/Customs Officer only.
 *     tags: [Customs]
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
 *               status: { type: string, enum: [PENDING, UNDER_REVIEW, APPROVED, REJECTED, CLEARED] }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Customs status updated
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Declaration not found
 */
router.put("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMS_OFFICER"), updateCustomsStatus)

export default router
