import { Router } from "express"
import { listOrders, getOrder, getOrderStats } from "./controller.js"
import { authenticate } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/orders:
 *   get:
 *     summary: List all orders
 *     description: Returns a list of all orders in the system.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of orders
 */
router.get("/", listOrders)

/**
 * @swagger
 * /api/v1/orders/stats:
 *   get:
 *     summary: Get order statistics
 *     description: Returns aggregate statistics for orders (total, pending, completed, revenue).
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Order statistics
 */
router.get("/stats", getOrderStats)

/**
 * @swagger
 * /api/v1/orders/{id}:
 *   get:
 *     summary: Get order by ID
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Order details
 *       404:
 *         description: Order not found
 */
router.get("/:id", getOrder)

export default router
