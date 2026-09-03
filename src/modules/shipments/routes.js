import { Router } from "express"
import multer from "multer"
import {
  createShipment, listShipments, getShipment,
  getShipmentByTracking, updateShipmentStatus,
  assignShipment, cancelShipment, getShipmentStats,
  verifyPickupOtp, verifyDeliveryOtp,
  uploadProofOfDelivery, getProofImages,
  scheduleShipment, listScheduledShipments,
  createParcelShipment, cancelShipmentWithReason,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

// Public tracking (no auth required)
/**
 * @swagger
 * /api/v1/shipments/track/{trackingNumber}:
 *   get:
 *     summary: Track shipment by tracking number (public)
 *     tags: [Tracking]
 *     parameters:
 *       - in: path
 *         name: trackingNumber
 *         required: true
 *         schema: { type: string }
 *         description: Tracking number (e.g. XRD-2026-123456)
 *     responses:
 *       200:
 *         description: Shipment tracking details
 *       404:
 *         description: Shipment not found
 */
router.get("/track/:trackingNumber", getShipmentByTracking)

router.use(authenticate)

// Parcel shipment creation (customer-facing)
/**
 * @swagger
 * /api/v1/shipments/parcel:
 *   post:
 *     summary: Create a parcel shipment
 *     tags: [Shipments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               senderName: { type: string }
 *               senderPhone: { type: string }
 *               senderAddress: { type: string }
 *               receiverName: { type: string }
 *               receiverPhone: { type: string }
 *               receiverAddress: { type: string }
 *               parcelCategoryId: { type: string }
 *               weightKg: { type: number }
 *               description: { type: string }
 *               isScheduled: { type: boolean }
 *               scheduledAt: { type: string, format: date-time }
 *               isParcelDeliveryProofEnabled: { type: boolean }
 *               payer: { type: string, enum: [SENDER, RECEIVER] }
 *     responses:
 *       201:
 *         description: Parcel shipment created
 */
router.post("/parcel", createParcelShipment)

// Scheduled shipments
/**
 * @swagger
 * /api/v1/shipments/scheduled:
 *   get:
 *     summary: List scheduled shipments
 *     tags: [Shipments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of scheduled shipments
 */
router.get("/scheduled", listScheduledShipments)

/**
 * @swagger
 * /api/v1/shipments/{id}/schedule:
 *   put:
 *     summary: Schedule a shipment
 *     tags: [Shipments]
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
 *               scheduledAt: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Shipment scheduled
 */
router.put("/:id/schedule", scheduleShipment)

// OTP verification
/**
 * @swagger
 * /api/v1/shipments/{id}/verify-pickup-otp:
 *   post:
 *     summary: Verify pickup OTP
 *     tags: [Shipments]
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
 *             required: [otp]
 *             properties:
 *               otp: { type: string, minLength: 4, maxLength: 6 }
 *     responses:
 *       200:
 *         description: OTP verified, pickup confirmed
 *       400:
 *         description: Invalid OTP
 */
router.post("/:id/verify-pickup-otp", verifyPickupOtp)

/**
 * @swagger
 * /api/v1/shipments/{id}/verify-delivery-otp:
 *   post:
 *     summary: Verify delivery OTP
 *     tags: [Shipments]
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
 *             required: [otp]
 *             properties:
 *               otp: { type: string, minLength: 4, maxLength: 6 }
 *     responses:
 *       200:
 *         description: OTP verified, delivery confirmed
 *       400:
 *         description: Invalid OTP
 */
router.post("/:id/verify-delivery-otp", verifyDeliveryOtp)

// Proof of delivery
/**
 * @swagger
 * /api/v1/shipments/{id}/proof:
 *   post:
 *     summary: Upload proof of delivery image
 *     tags: [Shipments]
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               notes: { type: string }
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               imageUrl: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Proof of delivery uploaded
 *       404:
 *         description: Shipment not found
 */
router.post("/:id/proof", upload.single("image"), uploadProofOfDelivery)

/**
 * @swagger
 * /api/v1/shipments/{id}/proof:
 *   get:
 *     summary: Get proof of delivery images
 *     tags: [Shipments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of proof images
 */
router.get("/:id/proof", getProofImages)

// Standard CRUD
/**
 * @swagger
 * /api/v1/shipments:
 *   post:
 *     summary: Create a shipment
 *     tags: [Shipments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Shipment created
 */
router.post("/", createShipment)

/**
 * @swagger
 * /api/v1/shipments:
 *   get:
 *     summary: List shipments
 *     tags: [Shipments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Filter by status
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of shipments
 */
router.get("/", listShipments)

/**
 * @swagger
 * /api/v1/shipments/stats:
 *   get:
 *     summary: Get shipment statistics
 *     tags: [Shipments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Shipment statistics
 */
router.get("/stats", getShipmentStats)

/**
 * @swagger
 * /api/v1/shipments/{id}:
 *   get:
 *     summary: Get shipment by ID
 *     tags: [Shipments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Shipment details
 *       404:
 *         description: Shipment not found
 */
router.get("/:id", getShipment)

/**
 * @swagger
 * /api/v1/shipments/{id}/status:
 *   put:
 *     summary: Update shipment status
 *     tags: [Shipments]
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [PENDING, ACCEPTED, OUT_FOR_PICKUP, PICKED_UP, IN_TRANSIT, ONGOING, OUT_FOR_DELIVERY, DELIVERED, RETURNING, RETURNED, FAILED, CANCELLED] }
 *               notes: { type: string }
 *               location: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200:
 *         description: Status updated
 */
router.put("/:id/status", updateShipmentStatus)

/**
 * @swagger
 * /api/v1/shipments/{id}/assign:
 *   put:
 *     summary: Assign a driver to a shipment
 *     tags: [Shipments]
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
 *             required: [driverId]
 *             properties:
 *               driverId: { type: string }
 *     responses:
 *       200:
 *         description: Driver assigned
 *       403:
 *         description: Insufficient permissions
 */
router.put("/:id/assign", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), assignShipment)

/**
 * @swagger
 * /api/v1/shipments/{id}/cancel:
 *   put:
 *     summary: Cancel a shipment
 *     tags: [Shipments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Shipment cancelled
 */
router.put("/:id/cancel", cancelShipment)

/**
 * @swagger
 * /api/v1/shipments/{id}/cancel-with-reason:
 *   put:
 *     summary: Cancel a shipment with a reason
 *     tags: [Shipments]
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
 *               reason: { type: string }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Shipment cancelled with reason
 */
router.put("/:id/cancel-with-reason", cancelShipmentWithReason)

export default router
