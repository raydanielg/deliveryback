import { Router } from "express"
import { listMyAddresses, getAddress, createAddress, updateAddress, deleteAddress } from "./controller.js"
import { authenticate } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/addresses:
 *   get:
 *     summary: List the current user's saved addresses
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Saved addresses, default first
 */
router.get("/", listMyAddresses)
router.get("/:id", getAddress)

/**
 * @swagger
 * /api/v1/addresses:
 *   post:
 *     summary: Save a new address
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, phone, line1, city]
 *             properties:
 *               label: { type: string }
 *               fullName: { type: string }
 *               phone: { type: string }
 *               line1: { type: string }
 *               line2: { type: string }
 *               city: { type: string }
 *               region: { type: string }
 *               district: { type: string }
 *               country: { type: string }
 *               postalCode: { type: string }
 *               isDefault: { type: boolean }
 *     responses:
 *       201:
 *         description: Address saved
 */
router.post("/", createAddress)
router.put("/:id", updateAddress)
router.delete("/:id", deleteAddress)

export default router
