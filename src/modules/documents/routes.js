import { Router } from "express"
import { listDocuments, uploadDocument, verifyDocument, deleteDocument } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

/**
 * @swagger
 * /api/v1/documents:
 *   get:
 *     summary: List all documents
 *     description: Returns all documents in the system (invoices, receipts, customs docs, etc.).
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of documents
 */
router.get("/", listDocuments)

/**
 * @swagger
 * /api/v1/documents:
 *   post:
 *     summary: Upload a document
 *     description: Uploads a new document (invoice, receipt, customs form, etc.) to the system.
 *     tags: [Documents]
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
 *               type: { type: string, enum: [INVOICE, RECEIPT, CUSTOMS_DECLARATION, BILL_OF_LADING, PACKING_LIST, OTHER] }
 *               fileUrl: { type: string, format: uri }
 *     responses:
 *       201:
 *         description: Document uploaded
 */
router.post("/", uploadDocument)

/**
 * @swagger
 * /api/v1/documents/{id}/verify:
 *   put:
 *     summary: Verify a document
 *     description: Marks a document as verified. Admin/Operations/Customs/Support only.
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Document verified
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Document not found
 */
router.put("/:id/verify", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMS_OFFICER", "CUSTOMER_SUPPORT"), verifyDocument)

/**
 * @swagger
 * /api/v1/documents/{id}:
 *   delete:
 *     summary: Delete a document
 *     description: Permanently deletes a document. Admin/Operations Manager only.
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Document deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), deleteDocument)

export default router
