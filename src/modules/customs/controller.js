import prisma from "../../prisma/client.js"
import { z } from "zod"

const createCustomsSchema = z.object({
  shipmentId: z.string(),
  declaredValue: z.number().min(0),
  currency: z.string().default("USD"),
  hsCode: z.string().optional(),
  description: z.string(),
  countryOfOrigin: z.string(),
  importExportType: z.enum(["IMPORT", "EXPORT", "TRANSIT"]).default("IMPORT"),
  documents: z.array(z.object({
    type: z.string(),
    documentNumber: z.string().optional(),
  })).optional(),
})

export async function getCustomsDeclaration(req, res, next) {
  try {
    const { shipmentId } = req.params
    const declaration = await prisma.customsDeclaration.findFirst({
      where: { shipmentId },
      include: { shipment: true },
    })
    if (!declaration) return res.status(404).json({ success: false, message: "Customs declaration not found" })
    res.json({ success: true, data: declaration })
  } catch (err) { next(err) }
}

export async function createCustomsDeclaration(req, res, next) {
  try {
    const data = createCustomsSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const existing = await prisma.customsDeclaration.findFirst({ where: { shipmentId: data.shipmentId } })
    if (existing) return res.status(400).json({ success: false, message: "Customs declaration already exists for this shipment" })

    const declaration = await prisma.customsDeclaration.create({
      data: {
        shipmentId: data.shipmentId,
        declaredValue: data.declaredValue,
        currency: data.currency,
        hsCode: data.hsCode,
        description: data.description,
        countryOfOrigin: data.countryOfOrigin,
        importExportType: data.importExportType,
        status: "PENDING",
      },
    })

    if (data.documents && data.documents.length > 0) {
      for (const doc of data.documents) {
        await prisma.shipmentDocument.create({
          data: {
            shipmentId: data.shipmentId,
            type: doc.type,
            documentNumber: doc.documentNumber,
            status: "PENDING",
          },
        })
      }
    }

    await prisma.shipment.update({
      where: { id: data.shipmentId },
      data: { status: "CUSTOMS_REVIEW" },
    })

    res.status(201).json({ success: true, data: declaration })
  } catch (err) { next(err) }
}

export async function updateCustomsStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status, customsOfficer, clearanceDate, notes } = req.body

    const declaration = await prisma.customsDeclaration.update({
      where: { id },
      data: {
        status,
        customsOfficer: customsOfficer || null,
        clearanceDate: clearanceDate ? new Date(clearanceDate) : (status === "CLEARED" ? new Date() : null),
        notes,
      },
    })

    if (status === "CLEARED") {
      await prisma.shipment.updateMany({
        where: { id: declaration.shipmentId },
        data: { status: "CUSTOMS_CLEARED" },
      })
    }

    res.json({ success: true, data: declaration })
  } catch (err) { next(err) }
}
