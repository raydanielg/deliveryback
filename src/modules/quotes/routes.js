import { Router } from "express"
import {
  calculateQuoteHandler, getMultipleQuotes, saveQuote,
  listQuotes, getQuote,
  createQuoteRequest, listQuoteRequests,
  respondToQuoteRequest, customerRespondToQuote,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/quotes/calculate:
 *   post:
 *     summary: Calculate a shipping quote
 *     description: Calculates the estimated shipping cost based on origin, destination, weight, and pricing rules.
 *     tags: [Quotes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               originCityId: { type: string }
 *               destinationCityId: { type: string }
 *               weightKg: { type: number }
 *               packageType: { type: string }
 *     responses:
 *       200:
 *         description: Calculated quote
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object, properties: { basePrice: { type: number }, distance: { type: number }, total: { type: number } } }
 */
router.post("/calculate", calculateQuoteHandler)

/**
 * @swagger
 * /api/v1/quotes/multiple:
 *   post:
 *     summary: Get multiple quotes at once
 *     description: Calculates quotes for multiple shipment options simultaneously.
 *     tags: [Quotes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quotes: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: Multiple calculated quotes
 */
router.post("/multiple", getMultipleQuotes)

/**
 * @swagger
 * /api/v1/quotes/save:
 *   post:
 *     summary: Save a quote
 *     description: Saves a calculated quote for future reference or to convert into a shipment.
 *     tags: [Quotes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quoteData: { type: object }
 *     responses:
 *       201:
 *         description: Quote saved
 */
router.post("/save", saveQuote)

/**
 * @swagger
 * /api/v1/quotes:
 *   get:
 *     summary: List saved quotes
 *     tags: [Quotes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of saved quotes
 */
router.get("/", listQuotes)

/**
 * @swagger
 * /api/v1/quotes/{id}:
 *   get:
 *     summary: Get a saved quote by ID
 *     tags: [Quotes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Quote details
 *       404:
 *         description: Quote not found
 */
router.get("/:id", getQuote)

/**
 * @swagger
 * /api/v1/quotes/requests:
 *   post:
 *     summary: Create a custom quote request
 *     description: Creates a custom quote request for heavy cargo or special shipments that don't fit standard pricing.
 *     tags: [Quotes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               origin: { type: string }
 *               destination: { type: string }
 *               cargoDetails: { type: string }
 *               weightKg: { type: number }
 *               volume: { type: string }
 *     responses:
 *       201:
 *         description: Quote request created
 */
router.post("/requests", createQuoteRequest)

/**
 * @swagger
 * /api/v1/quotes/requests:
 *   get:
 *     summary: List quote requests
 *     tags: [Quotes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of quote requests
 */
router.get("/requests", listQuoteRequests)

/**
 * @swagger
 * /api/v1/quotes/requests/{id}/respond:
 *   put:
 *     summary: Respond to a quote request (admin)
 *     description: Allows admin/operations/dispatcher to respond to a custom quote request with pricing.
 *     tags: [Quotes]
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
 *               estimatedDays: { type: integer }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Quote request responded to
 *       403:
 *         description: Insufficient permissions
 */
router.put("/requests/:id/respond", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), respondToQuoteRequest)

/**
 * @swagger
 * /api/v1/quotes/requests/{id}/customer-respond:
 *   put:
 *     summary: Customer responds to a quote request
 *     description: Allows customer to accept or reject a quote provided by the admin.
 *     tags: [Quotes]
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
 *               status: { type: string, enum: [ACCEPTED, REJECTED] }
 *     responses:
 *       200:
 *         description: Customer response recorded
 */
router.put("/requests/:id/customer-respond", customerRespondToQuote)

export default router
