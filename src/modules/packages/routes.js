import { Router } from "express"
import { getPackageByBarcode, listPackagesForShipment, scanPackage, getPackageDiscrepancy } from "./controller.js"
import { authenticate } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/packages/barcode/{barcode}:
 *   get:
 *     summary: Look up a package by its barcode
 *     tags: [Packages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Package found
 *       404:
 *         description: Package not found
 */
router.get("/barcode/:barcode", getPackageByBarcode)

/**
 * @swagger
 * /api/v1/packages/shipment/{shipmentId}:
 *   get:
 *     summary: List all packages for a shipment, with a status breakdown
 *     tags: [Packages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Packages for the shipment
 */
router.get("/shipment/:shipmentId", listPackagesForShipment)

/**
 * @swagger
 * /api/v1/packages/shipment/{shipmentId}/discrepancy:
 *   get:
 *     summary: Check whether all of a shipment's packages have been scanned, and flag damaged/lost ones
 *     tags: [Packages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: shipmentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Discrepancy report
 */
router.get("/shipment/:shipmentId/discrepancy", getPackageDiscrepancy)

/**
 * @swagger
 * /api/v1/packages/scan:
 *   post:
 *     summary: Scan a package barcode forward through its lifecycle
 *     description: Enforces forward-only progression (CREATED -> SCANNED_AT_PICKUP -> ... -> DELIVERED), with DAMAGED/LOST reachable as exception branches from any non-terminal state.
 *     tags: [Packages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode, status]
 *             properties:
 *               barcode: { type: string }
 *               status: { type: string, enum: [SCANNED_AT_PICKUP, SCANNED_AT_WAREHOUSE, LOADED, DEPARTED, ARRIVED, OUT_FOR_DELIVERY, DELIVERED, DAMAGED, LOST] }
 *               location: { type: string }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Package scanned
 *       400:
 *         description: Invalid status transition
 *       404:
 *         description: Package not found
 */
router.post("/scan", scanPackage)

export default router
