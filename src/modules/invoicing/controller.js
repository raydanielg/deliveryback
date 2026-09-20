import prisma from "../../prisma/client.js"
import { computeCharges } from "../delivery-config/controller.js"
import { emitToShipment } from "../../realtime/socket.js"
import { logAction } from "../../middleware/audit-logger.js"
import { createInvoiceSchema, bulkInvoiceSchema, recordPaymentSchema, reopenInvoiceSchema } from "./validation.js"

// XERIN Module 7 — Accounting & Invoicing.
// Invoice numbers are auto-generated INV-YYYY-NNNN (spec: must never be blank — D6).
// total = freight (entered by accountant) + storage + delivery (auto from computeCharges).

async function generateInvoiceNumber(tx = prisma) {
  const year = new Date().getFullYear()
  const prefix = `INV-${year}-`
  const latest = await tx.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  })
  const seq = latest ? parseInt(latest.invoiceNumber.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(seq).padStart(4, "0")}`
}

// Adjust the customer's running balance (deni la jumla). Positive delta = new debt,
// negative = payment/reversal. No-op when the shipment has no linked customer.
async function adjustCustomerBalance(tx, shipmentId, delta) {
  const shipment = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { customerId: true } })
  if (!shipment?.customerId) return
  await tx.customer.update({
    where: { id: shipment.customerId },
    data: { balance: { increment: delta } },
  })
}

export async function previewInvoice(req, res, next) {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.shipmentId },
      include: { deliveryZone: true, customer: { include: { user: { select: { name: true, phone: true } } } } },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const charges = await computeCharges(shipment)
    res.json({
      success: true,
      data: {
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        customer: shipment.customer?.user?.name || null,
        ...charges,
      },
    })
  } catch (err) { next(err) }
}

export async function listInvoices(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const { status, search } = req.query

    const where = { shipmentId: { not: null } } // XERIN invoices only — order invoices are a different flow
    if (status) where.status = status
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { shipment: { trackingNumber: { contains: search, mode: "insensitive" } } },
        { shipment: { customer: { user: { name: { contains: search, mode: "insensitive" } } } } },
      ]
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          shipment: {
            select: {
              id: true, trackingNumber: true, status: true,
              customer: { include: { user: { select: { name: true, phone: true } } } },
            },
          },
          preparedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ])

    res.json({ success: true, data: invoices, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function getInvoice(req, res, next) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        shipment: {
          include: {
            customer: { include: { user: { select: { name: true, phone: true, email: true } } } },
            deliveryZone: true,
          },
        },
        preparedBy: { select: { id: true, name: true } },
        paymentApprovals: { include: { approvedBy: { select: { id: true, name: true } } } },
      },
    })
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" })
    res.json({ success: true, data: invoice })
  } catch (err) { next(err) }
}

async function createInvoiceForShipment(tx, shipment, freightCharges, preparedById, remarks) {
  const { storageCharge, deliveryFee } = await computeCharges(shipment)
  const total = freightCharges + storageCharge + deliveryFee

  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber: await generateInvoiceNumber(tx),
      shipmentId: shipment.id,
      amount: total,
      total,
      freightCharges,
      storageCharges: storageCharge,
      deliveryCharges: deliveryFee,
      currency: shipment.currency || "TZS",
      preparedById,
      remarks: remarks || null,
      status: "UNPAID",
    },
  })

  // Status flow: On Shelf → Invoiced once freight is entered (spec §6).
  if (["ON_SHELF", "ARRIVED_TANZANIA"].includes(shipment.status)) {
    await tx.shipment.update({ where: { id: shipment.id }, data: { status: "INVOICED", lastMovementAt: new Date() } })
  }
  await tx.shipment.update({ where: { id: shipment.id }, data: { paymentStatus: "PENDING" } })

  await tx.trackingEvent.create({
    data: {
      shipmentId: shipment.id,
      event: "INVOICED",
      status: "INVOICED",
      description: `Invoice ${invoice.invoiceNumber} created — freight ${freightCharges}, storage ${storageCharge}, delivery ${deliveryFee}, total ${total}`,
      createdBy: preparedById,
    },
  })

  await adjustCustomerBalance(tx, shipment.id, total)
  return invoice
}

export async function createInvoice(req, res, next) {
  try {
    const data = createInvoiceSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({
      where: { id: data.shipmentId },
      include: { deliveryZone: true },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const openInvoice = await prisma.invoice.findFirst({
      where: { shipmentId: shipment.id, status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
    })
    if (openInvoice) {
      return res.status(400).json({ success: false, message: `Shipment already has an open invoice (${openInvoice.invoiceNumber})` })
    }

    const invoice = await prisma.$transaction((tx) =>
      createInvoiceForShipment(tx, shipment, data.freightCharges, req.user.id, data.remarks)
    )

    await logAction({
      userId: req.user.id, action: "CREATE_INVOICE", entity: "Invoice", entityId: invoice.id,
      changes: { invoiceNumber: invoice.invoiceNumber, shipmentId: shipment.id, total: invoice.total }, req,
    })
    emitToShipment(shipment.id, "shipment:invoiced", { shipmentId: shipment.id, invoiceNumber: invoice.invoiceNumber, total: invoice.total })

    res.status(201).json({ success: true, data: invoice, message: `Invoice ${invoice.invoiceNumber} created` })
  } catch (err) { next(err) }
}

export async function bulkCreateInvoices(req, res, next) {
  try {
    const data = bulkInvoiceSchema.parse(req.body)
    const results = { created: [], skipped: [] }

    for (const shipmentId of data.shipmentIds) {
      const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, include: { deliveryZone: true } })
      if (!shipment) { results.skipped.push({ shipmentId, reason: "not found" }); continue }
      const open = await prisma.invoice.findFirst({ where: { shipmentId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } } })
      if (open) { results.skipped.push({ shipmentId, reason: `open invoice ${open.invoiceNumber}` }); continue }
      const invoice = await prisma.$transaction((tx) =>
        createInvoiceForShipment(tx, shipment, data.freightCharges ?? 0, req.user.id, null)
      )
      results.created.push({ shipmentId, invoiceNumber: invoice.invoiceNumber, total: invoice.total })
    }

    await logAction({
      userId: req.user.id, action: "BULK_CREATE_INVOICES", entity: "Invoice",
      changes: { created: results.created.length, skipped: results.skipped.length }, req,
    })

    res.status(201).json({ success: true, data: results, message: `${results.created.length} invoice(s) created, ${results.skipped.length} skipped` })
  } catch (err) { next(err) }
}

export async function recordPayment(req, res, next) {
  try {
    const data = recordPaymentSchema.parse(req.body)

    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } })
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" })
    if (invoice.status === "PAID") return res.status(400).json({ success: false, message: "Invoice is already paid" })

    const paidAt = data.paidAt ? new Date(data.paidAt) : new Date()

    const updated = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paidAt, paymentMethod: data.paymentMethod, remarks: data.remarks ?? invoice.remarks },
      })
      if (invoice.shipmentId) {
        await tx.shipment.update({ where: { id: invoice.shipmentId }, data: { paymentStatus: "PAID" } })
        await tx.trackingEvent.create({
          data: {
            shipmentId: invoice.shipmentId, event: "PAYMENT_RECORDED", status: "INVOICED",
            description: `Payment of ${invoice.total} ${invoice.currency} recorded via ${data.paymentMethod} on invoice ${invoice.invoiceNumber}`,
            createdBy: req.user.id,
          },
        })
        await adjustCustomerBalance(tx, invoice.shipmentId, -Number(invoice.total))
      }
      return inv
    })

    await logAction({
      userId: req.user.id, action: "RECORD_PAYMENT", entity: "Invoice", entityId: invoice.id,
      changes: { invoiceNumber: invoice.invoiceNumber, method: data.paymentMethod, total: invoice.total }, req,
    })

    res.json({ success: true, data: updated, message: `Payment recorded on ${invoice.invoiceNumber}` })
  } catch (err) { next(err) }
}

// Reopen a paid invoice — Operations Manager / Super Admin only, reason mandatory (spec Module 7).
export async function reopenInvoice(req, res, next) {
  try {
    const data = reopenInvoiceSchema.parse(req.body)

    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } })
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" })
    if (invoice.status !== "PAID") return res.status(400).json({ success: false, message: "Only a paid invoice can be reopened" })

    const updated = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: "UNPAID", paidAt: null, paymentMethod: null },
      })
      if (invoice.shipmentId) {
        await tx.shipment.update({ where: { id: invoice.shipmentId }, data: { paymentStatus: "PENDING" } })
        await adjustCustomerBalance(tx, invoice.shipmentId, Number(invoice.total))
      }
      return inv
    })

    await logAction({
      userId: req.user.id, action: "REOPEN_INVOICE", entity: "Invoice", entityId: invoice.id,
      changes: { invoiceNumber: invoice.invoiceNumber, reason: data.reason }, req,
    })

    res.json({ success: true, data: updated, message: `Invoice ${invoice.invoiceNumber} reopened` })
  } catch (err) { next(err) }
}
