import { Router } from "express"
import multer from "multer"
import {
  listClaims, getClaim, createClaim,
  updateClaimStatus, assignClaim, getClaimStats,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"
import { auditMiddleware } from "../../middleware/audit-logger.js"

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
})

const STAFF_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"]

router.use(authenticate)

/**
 * @swagger
 * /api/v1/claims:
 *   get:
 *     summary: List claims (customers see only their own; staff see all)
 *     tags: [Claims]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of claims
 */
router.get("/", listClaims)
router.get("/stats", authorizeRoles(...STAFF_ROLES), getClaimStats)
router.get("/:id", getClaim)

/**
 * @swagger
 * /api/v1/claims:
 *   post:
 *     summary: File a claim against a shipment (lost/damaged/missing/wrong delivery/delayed)
 *     tags: [Claims]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [shipmentId, type, description]
 *             properties:
 *               shipmentId: { type: string }
 *               type: { type: string, enum: [LOST, DAMAGED, MISSING_ITEM, WRONG_DELIVERY, DELAYED, OTHER] }
 *               description: { type: string }
 *               claimedAmount: { type: number }
 *               evidence:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Claim created
 */
router.post("/", upload.array("evidence", 5), auditMiddleware("claim"), createClaim)

/**
 * @swagger
 * /api/v1/claims/{id}/status:
 *   patch:
 *     summary: Move a claim through its workflow (staff only)
 *     description: Enforces OPEN -> UNDER_REVIEW -> INVESTIGATION -> APPROVED/REJECTED -> RESOLUTION -> CLOSED.
 *     tags: [Claims]
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
 *               status: { type: string, enum: [OPEN, UNDER_REVIEW, INVESTIGATION, APPROVED, REJECTED, RESOLUTION, CLOSED] }
 *               resolution: { type: string }
 *               resolvedAmount: { type: number }
 *     responses:
 *       200:
 *         description: Claim updated
 *       400:
 *         description: Invalid status transition
 */
router.patch("/:id/status", authorizeRoles(...STAFF_ROLES), auditMiddleware("claim"), updateClaimStatus)

/**
 * @swagger
 * /api/v1/claims/{id}/assign:
 *   patch:
 *     summary: Assign a claim to a staff member
 *     tags: [Claims]
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
 *             required: [assignedToId]
 *             properties:
 *               assignedToId: { type: string }
 *     responses:
 *       200:
 *         description: Claim assigned
 */
router.patch("/:id/assign", authorizeRoles(...STAFF_ROLES), auditMiddleware("claim"), assignClaim)

export default router
