import { Router } from "express"
import {
  listManifests,
  getManifest,
  createManifest,
  createSGRManifest,
  scanParcelLoad,
  completeLoading,
  signHandover,
  getManifestByQR,
  updateManifestStatus,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/manifests:
 *   get:
 *     summary: List all manifests
 *     description: Returns shipment manifests used for grouping multiple shipments for a single trip/route.
 *     tags: [Manifests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of manifests
 */
router.get("/", listManifests)

/**
 * @swagger
 * /api/v1/manifests/{id}:
 *   get:
 *     summary: Get manifest by ID
 *     description: Returns a single manifest with full details including shipments and handover chain.
 *     tags: [Manifests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Manifest details
 *       404:
 *         description: Manifest not found
 */
router.get("/:id", getManifest)

/**
 * @swagger
 * /api/v1/manifests/qr/{qrCode}:
 *   get:
 *     summary: Get manifest by QR code
 *     description: Scan QR code to get full manifest with parcels and dispatch info.
 *     tags: [Manifests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: qrCode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Manifest found
 *       404:
 *         description: Invalid QR code
 */
router.get("/qr/:qrCode", getManifestByQR)

/**
 * @swagger
 * /api/v1/manifests:
 *   post:
 *     summary: Create a manifest
 *     description: Creates a new manifest grouping multiple shipments. Admin/Operations/Dispatcher only.
 *     tags: [Manifests]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               driverId: { type: string }
 *               vehicleId: { type: string }
 *               shipmentIds: { type: array, items: { type: string } }
 *               routeId: { type: string }
 *     responses:
 *       201:
 *         description: Manifest created
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), createManifest)

/**
 * @swagger
 * /api/v1/manifests/sgr:
 *   post:
 *     summary: Create SGR Parcel Manifest
 *     description: Creates an SGR parcel manifest with batch, block space, QR code, and handover chain.
 *     tags: [Manifests]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               originStation: { type: string }
 *               destinationStation: { type: string }
 *               serviceType: { type: string }
 *               batchNo: { type: string }
 *               reservedBlockSpaceKg: { type: number }
 *               routeId: { type: string }
 *               shipmentIds: { type: array, items: { type: string } }
 *               dispatchDate: { type: string, format: date-time }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: SGR manifest created
 *       400:
 *         description: Validation error
 */
router.post("/sgr", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), createSGRManifest)

/**
 * @swagger
 * /api/v1/manifests/{id}/scan:
 *   post:
 *     summary: Scan parcel for loading
 *     description: Scan a parcel tracking number to mark it as LOADED in the manifest.
 *     tags: [Manifests]
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
 *               trackingNumber: { type: string }
 *     responses:
 *       200:
 *         description: Parcel loaded
 *       404:
 *         description: Parcel not in manifest
 */
router.post("/:id/scan", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), scanParcelLoad)

/**
 * @swagger
 * /api/v1/manifests/{id}/complete-loading:
 *   post:
 *     summary: Complete loading and finalize departure manifest
 *     description: Removes unscanned parcels and finalizes the manifest for departure.
 *     tags: [Manifests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Loading completed
 */
router.post("/:id/complete-loading", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), completeLoading)

/**
 * @swagger
 * /api/v1/manifests/{id}/handover:
 *   post:
 *     summary: Sign handover chain step
 *     description: Sign a handover step (PREPARED, VERIFIED_STATION, HANDED_OVER_RAIL, RECEIVED_DESTINATION, RECONCILED).
 *     tags: [Manifests]
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
 *               step: { type: string, enum: [PREPARED, VERIFIED_STATION, HANDED_OVER_RAIL, RECEIVED_DESTINATION, RECONCILED] }
 *               name: { type: string }
 *               signature: { type: string }
 *     responses:
 *       201:
 *         description: Handover signed
 *       400:
 *         description: Step already signed
 */
router.post("/:id/handover", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), signHandover)

/**
 * @swagger
 * /api/v1/manifests/{id}/status:
 *   patch:
 *     summary: Update manifest status
 *     description: Updates manifest status (PENDING, LOADING, DEPARTED, IN_TRANSIT, ARRIVED, COMPLETED, CANCELLED).
 *     tags: [Manifests]
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
 *               status: { type: string, enum: [PENDING, LOADING, DEPARTED, IN_TRANSIT, ARRIVED, COMPLETED, CANCELLED] }
 *     responses:
 *       200:
 *         description: Manifest status updated
 *       404:
 *         description: Manifest not found
 */
router.patch("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), updateManifestStatus)

export default router
