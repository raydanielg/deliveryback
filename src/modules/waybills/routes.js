import { Router } from "express"
import { getWaybill } from "./controller.js"
import { authenticate } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/waybills/{shipmentId}:
 *   get:
 *     summary: Get waybill for a shipment
 *     description: Returns the waybill document for a specific shipment, containing sender, receiver, and shipment details.
 *     tags: [Waybills]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema: { type: string }
 *         description: Shipment ID
 *     responses:
 *       200:
 *         description: Waybill details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object, properties: { waybillNumber: { type: string }, sender: { type: object }, receiver: { type: object }, shipment: { type: object } } }
 *       404:
 *         description: Shipment not found
 */
router.get("/:shipmentId", getWaybill)

export default router
