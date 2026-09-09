import prisma from "../../prisma/client.js"
import { z } from "zod"

const uploadDocumentSchema = z.object({
  shipmentId: z.string(),
  type: z.enum([
    "INVOICE", "PACKING_LIST", "BILL_OF_LADING", "AIRWAY_BILL",
    "CERTIFICATE_OF_ORIGIN", "CUSTOMS_DECLARATION", "INSURANCE_CERT",
    "EXPORT_PERMIT", "IMPORT_PERMIT", "HEALTH_CERT", "PHYTO_CERT",
    "COMMERCIAL_INVOICE", "PROFORMA_INVOICE", "OTHER",
  ]),
  documentNumber: z.string().optional(),
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  mimeType: z.string().optional(),
})

const STAFF_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMS_OFFICER", "CUSTOMER_SUPPORT", "WAREHOUSE_MANAGER", "DISPATCHER"]

export async function listDocuments(req, res, next) {
  try {
    const { shipmentId } = req.query
    const isStaff = STAFF_ROLES.includes(req.user.role)

    // Non-staff (CUSTOMER/DRIVER) must scope to one shipment they actually own — without
    // this, calling GET /documents with no filter (or with someone else's shipmentId)
    // previously returned every invoice/customs-declaration/bill-of-lading fileUrl in
    // the system to any authenticated user.
    if (!isStaff) {
      if (!shipmentId) {
        return res.status(400).json({ success: false, message: "shipmentId is required" })
      }
      const shipment = await prisma.shipment.findUnique({
        where: { id: shipmentId },
        select: { createdById: true, driverId: true },
      })
      if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })
      if (req.user.role === "CUSTOMER" && shipment.createdById !== req.user.id) {
        return res.status(404).json({ success: false, message: "Shipment not found" })
      }
      if (req.user.role === "DRIVER") {
        const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } })
        if (!driver || shipment.driverId !== driver.id) {
          return res.status(404).json({ success: false, message: "Shipment not found" })
        }
      }
    }

    const where = {}
    if (shipmentId) where.shipmentId = shipmentId

    const documents = await prisma.shipmentDocument.findMany({
      where,
      include: { shipment: { select: { trackingNumber: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ success: true, data: documents })
  } catch (err) { next(err) }
}

export async function uploadDocument(req, res, next) {
  try {
    const data = uploadDocumentSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    if (!STAFF_ROLES.includes(req.user.role)) {
      if (req.user.role === "CUSTOMER" && shipment.createdById !== req.user.id) {
        return res.status(404).json({ success: false, message: "Shipment not found" })
      }
      if (req.user.role === "DRIVER") {
        const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } })
        if (!driver || shipment.driverId !== driver.id) {
          return res.status(404).json({ success: false, message: "Shipment not found" })
        }
      }
    }

    const doc = await prisma.shipmentDocument.create({
      data: {
        shipmentId: data.shipmentId,
        type: data.type,
        documentNumber: data.documentNumber,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        status: "PENDING",
        uploadedBy: req.user.id,
      },
    })

    res.status(201).json({ success: true, data: doc })
  } catch (err) { next(err) }
}

export async function verifyDocument(req, res, next) {
  try {
    const { id } = req.params
    const { status, verifiedBy } = req.body

    const doc = await prisma.shipmentDocument.update({
      where: { id },
      data: {
        status,
        verifiedBy: verifiedBy || req.user.id,
        verifiedAt: new Date(),
      },
    })

    res.json({ success: true, data: doc })
  } catch (err) { next(err) }
}

export async function deleteDocument(req, res, next) {
  try {
    const { id } = req.params
    await prisma.shipmentDocument.delete({ where: { id } })
    res.json({ success: true, message: "Document deleted" })
  } catch (err) { next(err) }
}
