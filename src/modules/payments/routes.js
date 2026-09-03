import { Router } from "express"
import { listPayments, createPayment, getPayment } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/payments:
 *   get:
 *     summary: List all payments
 *     description: Returns a list of all payment records in the system.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of payments
 */
router.get("/", listPayments)

/**
 * @swagger
 * /api/v1/payments:
 *   post:
 *     summary: Create a payment record
 *     description: Records a new payment for a shipment or service.
 *     tags: [Payments]
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
 *               amount: { type: number }
 *               method: { type: string, enum: [CASH, CARD, MOBILE_MONEY, BANK_TRANSFER] }
 *               status: { type: string, enum: [PENDING, COMPLETED, FAILED, REFUNDED] }
 *     responses:
 *       201:
 *         description: Payment created
 */
router.post("/", createPayment)

/**
 * @swagger
 * /api/v1/payments/{id}:
 *   get:
 *     summary: Get payment by ID
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Payment details
 *       404:
 *         description: Payment not found
 */
router.get("/:id", getPayment)

export default router
