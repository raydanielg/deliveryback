import prisma from "../../prisma/client.js"
import { z } from "zod"
import { createNotification } from "../notifications/controller.js"

const createPaymentSchema = z.object({
  orderId: z.string(),
  amount: z.number().min(0.01),
  method: z.enum(["MOBILE_MONEY", "BANK_TRANSFER", "CARD", "CASH", "CREDIT", "MANUAL", "WALLET"]),
  transactionId: z.string().optional(),
})

function generatePaymentRef() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  return `PAY-${year}-${random}`
}

export async function listPayments(req, res, next) {
  try {
    // Previously unscoped — any authenticated user, including a customer, could list the
    // 50 most recent payments platform-wide (amounts, methods, transaction IDs, other
    // customers' names/emails).
    const where = req.user.role === "CUSTOMER" ? { payerId: req.user.id } : {}
    const payments = await prisma.payment.findMany({
      where,
      include: { order: true, payer: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    res.json({ success: true, data: payments })
  } catch (err) { next(err) }
}

export async function createPayment(req, res, next) {
  try {
    const data = createPaymentSchema.parse(req.body)

    const order = await prisma.order.findUnique({ where: { id: data.orderId } })
    if (!order) return res.status(404).json({ success: false, message: "Order not found" })

    // Payment record, order balance recompute, and shipment activation must commit together —
    // otherwise a crash between steps can leave a payment recorded as PAID with the shipment
    // still unpaid, or vice versa.
    const { payment, paymentStatus } = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          paymentRef: generatePaymentRef(),
          orderId: data.orderId,
          payerId: req.user.id,
          amount: data.amount,
          method: data.method,
          status: "PAID",
          transactionId: data.transactionId,
          paidAt: new Date(),
        },
      })

      const totalPaid = await tx.payment.aggregate({
        where: { orderId: data.orderId, status: "PAID" },
        _sum: { amount: true },
      })

      const orderTotal = Number(order.totalAmount)
      const paidAmount = Number(totalPaid._sum.amount || 0)

      let paymentStatus = "PARTIAL"
      if (paidAmount >= orderTotal) paymentStatus = "PAID"

      await tx.order.update({
        where: { id: data.orderId },
        data: { paymentStatus },
      })

      if (paymentStatus === "PAID") {
        await tx.shipment.updateMany({
          where: { orderId: data.orderId },
          data: { paymentStatus: "PAID", status: "PAYMENT_CONFIRMED" },
        })
      }

      return { payment, paymentStatus }
    })

    if (paymentStatus === "PAID") {
      try {
        await createNotification(
          order.createdById,
          "PAYMENT_CONFIRMED",
          "Payment Confirmed",
          `Your payment of ${order.currency} ${Number(data.amount).toLocaleString()} for order ${order.orderNumber} has been confirmed.`,
          { orderId: order.id, paymentRef: payment.paymentRef }
        )
      } catch (notifErr) {
        console.warn("Payment notification failed:", notifErr.message)
      }
    }

    res.status(201).json({ success: true, data: payment })
  } catch (err) { next(err) }
}

export async function getPayment(req, res, next) {
  try {
    const { id } = req.params
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { order: true },
    })
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" })

    if (req.user.role === "CUSTOMER" && payment.payerId !== req.user.id) {
      return res.status(404).json({ success: false, message: "Payment not found" })
    }

    res.json({ success: true, data: payment })
  } catch (err) { next(err) }
}
