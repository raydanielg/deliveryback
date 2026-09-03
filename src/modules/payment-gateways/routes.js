import { Router } from "express"
import {
  listPaymentGateways, getPaymentGateway, createPaymentGateway,
  updatePaymentGateway, deletePaymentGateway, togglePaymentGateway,
  initiatePayment, selcomWebhook, azampesaCallback, getActiveGateways,
  getSelcomOrderStatus, cancelSelcomOrder,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

/**
 * @swagger
 * /api/v1/payment-gateways/webhooks/selcom:
 *   post:
 *     summary: Selcom webhook endpoint (public)
 *     description: Receives payment status webhooks from Selcom payment gateway. No authentication required - called by Selcom servers.
 *     tags: [Payment Gateways]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Selcom webhook payload
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post("/webhooks/selcom", selcomWebhook)

/**
 * @swagger
 * /api/v1/payment-gateways/callbacks/azampesa:
 *   post:
 *     summary: AzamPesa callback endpoint (public)
 *     description: Receives payment status callbacks from AzamPesa mobile money gateway. No authentication required.
 *     tags: [Payment Gateways]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: AzamPesa callback payload
 *     responses:
 *       200:
 *         description: Callback processed
 */
router.post("/callbacks/azampesa", azampesaCallback)

/**
 * @swagger
 * /api/v1/payment-gateways/active:
 *   get:
 *     summary: Get active payment gateways
 *     description: Returns all active payment gateways for customer app to display payment options.
 *     tags: [Payment Gateways]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active gateways
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object, properties: { id: { type: string }, name: { type: string }, provider: { type: string, enum: [SELCOM, AZAMPESA, MPESA, TIGOPESA, HALOPESA] }, logo: { type: string }, isActive: { type: boolean } } } }
 */
router.get("/active", authenticate, getActiveGateways)

router.use(authenticate)

/**
 * @swagger
 * /api/v1/payment-gateways/initiate:
 *   post:
 *     summary: Initiate a payment
 *     description: Initiates a payment through the specified gateway. Returns a payment URL or USSD code for the customer to complete payment.
 *     tags: [Payment Gateways]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [gatewayId, amount, phone]
 *             properties:
 *               gatewayId: { type: string, description: "Payment gateway ID" }
 *               amount: { type: number, description: "Amount to pay" }
 *               phone: { type: string, description: "Customer phone number (e.g. +255700000000)" }
 *               shipmentId: { type: string, description: "Associated shipment ID" }
 *               currency: { type: string, default: "TZS" }
 *     responses:
 *       200:
 *         description: Payment initiated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object, properties: { paymentId: { type: string }, paymentUrl: { type: string }, reference: { type: string }, status: { type: string } } }
 *       400:
 *         description: Invalid request or gateway inactive
 */
router.post("/initiate", initiatePayment)

/**
 * @swagger
 * /api/v1/payment-gateways/selcom/order-status:
 *   get:
 *     summary: Check Selcom order status
 *     description: Queries the current status of a Selcom payment order.
 *     tags: [Payment Gateways]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: order_id
 *         required: true
 *         schema: { type: string }
 *         description: Selcom order ID
 *     responses:
 *       200:
 *         description: Order status
 */
router.get("/selcom/order-status", getSelcomOrderStatus)

/**
 * @swagger
 * /api/v1/payment-gateways/selcom/cancel-order:
 *   delete:
 *     summary: Cancel a Selcom order
 *     description: Cancels a pending Selcom payment order.
 *     tags: [Payment Gateways]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: order_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Order cancelled
 */
router.delete("/selcom/cancel-order", cancelSelcomOrder)

/**
 * @swagger
 * /api/v1/payment-gateways:
 *   get:
 *     summary: List all payment gateways (admin)
 *     description: Returns all payment gateways including inactive ones. Admin/Finance only.
 *     tags: [Payment Gateways]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all gateways
 *       403:
 *         description: Insufficient permissions
 */
router.get("/", authorizeRoles("SUPER_ADMIN", "FINANCE"), listPaymentGateways)

/**
 * @swagger
 * /api/v1/payment-gateways/{id}:
 *   get:
 *     summary: Get payment gateway by ID (admin)
 *     tags: [Payment Gateways]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Gateway details
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Gateway not found
 */
router.get("/:id", authorizeRoles("SUPER_ADMIN", "FINANCE"), getPaymentGateway)

/**
 * @swagger
 * /api/v1/payment-gateways:
 *   post:
 *     summary: Create a payment gateway (admin)
 *     description: Configures a new payment gateway with API credentials. Admin/Finance only.
 *     tags: [Payment Gateways]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, provider]
 *             properties:
 *               name: { type: string }
 *               provider: { type: string, enum: [SELCOM, AZAMPESA, MPESA, TIGOPESA, HALOPESA] }
 *               apiKey: { type: string, description: "Gateway API key" }
 *               apiSecret: { type: string, description: "Gateway API secret" }
 *               webhookUrl: { type: string, format: uri }
 *               callbackUrl: { type: string, format: uri }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Gateway created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "FINANCE"), createPaymentGateway)

/**
 * @swagger
 * /api/v1/payment-gateways/{id}:
 *   put:
 *     summary: Update a payment gateway (admin)
 *     tags: [Payment Gateways]
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
 *               apiKey: { type: string }
 *               apiSecret: { type: string }
 *               webhookUrl: { type: string, format: uri }
 *               callbackUrl: { type: string, format: uri }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Gateway updated
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Gateway not found
 */
router.put("/:id", authorizeRoles("SUPER_ADMIN", "FINANCE"), updatePaymentGateway)

/**
 * @swagger
 * /api/v1/payment-gateways/{id}:
 *   delete:
 *     summary: Delete a payment gateway (super admin only)
 *     tags: [Payment Gateways]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Gateway deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deletePaymentGateway)

/**
 * @swagger
 * /api/v1/payment-gateways/{id}/toggle:
 *   patch:
 *     summary: Toggle gateway active status (admin)
 *     tags: [Payment Gateways]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Gateway toggled
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Gateway not found
 */
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "FINANCE"), togglePaymentGateway)

export default router
