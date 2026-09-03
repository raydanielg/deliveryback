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

export async function listDocuments(req, res, next) {
  try {
    const { shipmentId } = req.query
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
