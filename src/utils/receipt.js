import PDFDocument from "pdfkit"

// Renders a payment receipt as a PDF stream. Generated on-demand from the current
// Payment/Order/Shipment records rather than persisted to disk or a new DB column —
// this avoids a schema migration (schema.prisma is under active concurrent development
// this session) and guarantees the receipt always reflects the record's current state.
export function streamPaymentReceipt(payment, res) {
  const doc = new PDFDocument({ size: "A4", margin: 50 })
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="receipt-${payment.paymentRef}.pdf"`)
  doc.pipe(res)

  const order = payment.order
  const currency = payment.currency || order?.currency || "TZS"
  const amount = Number(payment.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  doc
    .fontSize(20).font("Helvetica-Bold").text("XERIN EXPRESS", { align: "left" })
    .fontSize(9).font("Helvetica").fillColor("#666666").text("Move Anything. Anytime. Anywhere.")
    .moveDown(1.5)

  doc
    .fillColor("#000000").fontSize(16).font("Helvetica-Bold").text("Payment Receipt")
    .moveDown(0.75)

  doc.fontSize(10)
  const row = (label, value) => {
    const y = doc.y
    doc.font("Helvetica").fillColor("#666666").text(label, 50, y, { width: 140 })
    doc.font("Helvetica-Bold").fillColor("#000000").text(value || "-", 200, y, { width: 345 })
    doc.y = y + 18
  }

  row("Receipt / Payment Ref:", payment.paymentRef)
  row("Date:", (payment.paidAt || payment.createdAt) ? new Date(payment.paidAt || payment.createdAt).toLocaleString() : "-")
  row("Status:", payment.status)
  row("Payment Method:", (payment.method || "").replace(/_/g, " "))
  if (payment.transactionId) row("Transaction ID:", payment.transactionId)
  doc.moveDown(0.5)

  if (order) {
    row("Order Number:", order.orderNumber)
    row("Order Total:", `${order.currency || currency} ${Number(order.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    row("Order Payment Status:", order.paymentStatus)
  }

  const trackingNumbers = (order?.shipments || []).map((s) => s.trackingNumber).filter(Boolean)
  if (trackingNumbers.length > 0) {
    row("Tracking Number(s):", trackingNumbers.join(", "))
  }

  if (payment.payer?.name) row("Paid By:", payment.payer.name)

  doc.y += 15
  const boxY = doc.y
  doc.rect(50, boxY, 495, 50).fillAndStroke("#f8f9fa", "#e2e8f0")
  doc
    .fillColor("#000000").fontSize(11).font("Helvetica-Bold")
    .text("Amount Paid", 65, boxY + 10, { width: 465 })
    .fontSize(18)
    .text(`${currency} ${amount}`, 65, boxY + 25, { width: 465 })
  doc.y = boxY + 65

  doc
    .fontSize(8).font("Helvetica").fillColor("#999999")
    .text("This is a system-generated receipt and does not require a signature.", 50, doc.y, { align: "center", width: 495 })
    .text(`Generated on ${new Date().toLocaleString()}`, { align: "center", width: 495 })

  doc.end()
}
