import prisma from "../../prisma/client.js"

function generateWaybillNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, "0")
  return `WD-${year}-${random}`
}

export async function getWaybill(req, res, next) {
  try {
    const { shipmentId } = req.params
    const waybill = await prisma.waybill.findFirst({
      where: { shipmentId },
    })

    if (!waybill) {
      const shipment = await prisma.shipment.findUnique({
        where: { id: shipmentId },
        include: {
          fromAddress: true,
          toAddress: true,
          packages: true,
          order: true,
        },
      })

      if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

      const newWaybill = await prisma.waybill.create({
        data: {
          waybillNumber: generateWaybillNumber(),
          shipmentId,
          senderName: shipment.fromAddress.fullName,
          senderPhone: shipment.fromAddress.phone,
          senderAddress: `${shipment.fromAddress.line1}, ${shipment.fromAddress.city}, ${shipment.fromAddress.country}`,
          recipientName: shipment.toAddress.fullName,
          recipientPhone: shipment.toAddress.phone,
          recipientAddress: `${shipment.toAddress.line1}, ${shipment.toAddress.city}, ${shipment.toAddress.country}`,
          origin: `${shipment.fromAddress.city}, ${shipment.fromAddress.country}`,
          destination: `${shipment.toAddress.city}, ${shipment.toAddress.country}`,
          weightKg: shipment.chargeableWeightKg,
          packageType: shipment.packages[0]?.type || "PARCEL",
          transportMode: shipment.transportMode,
          totalAmount: shipment.totalAmount,
          currency: shipment.currency,
          barcodeData: shipment.trackingNumber,
          qrCodeData: shipment.trackingNumber,
        },
      })

      return res.json({ success: true, data: newWaybill })
    }

    res.json({ success: true, data: waybill })
  } catch (err) { next(err) }
}
