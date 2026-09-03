import { Router } from "express"
import { listCustomers, createCustomer, getCustomer, updateCustomer, getCustomerStats } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/customers:
 *   get:
 *     summary: List all customers
 *     description: Returns a list of all registered customers in the system.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of customers
 */
router.get("/", listCustomers)

/**
 * @swagger
 * /api/v1/customers:
 *   post:
 *     summary: Create a customer profile
 *     description: Creates a new customer profile. Admin/Operations/Support only.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               address: { type: string }
 *     responses:
 *       201:
 *         description: Customer created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"), createCustomer)

/**
 * @swagger
 * /api/v1/customers/{id}:
 *   get:
 *     summary: Get customer by ID
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Customer details
 *       404:
 *         description: Customer not found
 */
router.get("/:id", getCustomer)

/**
 * @swagger
 * /api/v1/customers/{id}:
 *   put:
 *     summary: Update customer profile
 *     description: Updates customer information. Admin/Operations/Support only.
 *     tags: [Customers]
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
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               address: { type: string }
 *     responses:
 *       200:
 *         description: Customer updated
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Customer not found
 */
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"), updateCustomer)

/**
 * @swagger
 * /api/v1/customers/{id}/stats:
 *   get:
 *     summary: Get customer statistics
 *     description: Returns shipment count, total spent, and other stats for a specific customer.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Customer statistics
 *       404:
 *         description: Customer not found
 */
router.get("/:id/stats", getCustomerStats)

export default router
