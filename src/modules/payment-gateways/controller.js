import prisma from "../../prisma/client.js"
import { createPaymentGatewaySchema, initiatePaymentSchema } from "./validation.js"
import { createNotification } from "../notifications/controller.js"
import { emitEvent, EVENTS } from "../integrations/event-bus.js"
import crypto from "crypto"

// --- Payment Gateway CRUD ---

export async function listPaymentGateways(req, res, next) {
  try {
    const { activeOnly } = req.query
    const where = activeOnly === "true" ? { isActive: true } : {}
    const gateways = await prisma.paymentGateway.findMany({
      where,
      orderBy: { createdAt: "desc" },
    })
    // Mask sensitive values
    const masked = gateways.map(g => ({
      ...g,
      liveValues: g.liveValues ? "[REDACTED]" : null,
      testValues: g.testValues ? "[REDACTED]" : null,
    }))
    res.json({ success: true, data: masked })
  } catch (err) { next(err) }
}

export async function getPaymentGateway(req, res, next) {
  try {
    const { id } = req.params
    const gateway = await prisma.paymentGateway.findUnique({ where: { id } })
    if (!gateway) return res.status(404).json({ success: false, message: "Gateway not found" })
    res.json({
      success: true,
      data: {
        ...gateway,
        liveValues: gateway.liveValues ? "[REDACTED]" : null,
        testValues: gateway.testValues ? "[REDACTED]" : null,
      },
    })
  } catch (err) { next(err) }
}

export async function createPaymentGateway(req, res, next) {
  try {
    const data = createPaymentGatewaySchema.parse(req.body)
    const gateway = await prisma.paymentGateway.create({ data })
    res.status(201).json({ success: true, data: { ...gateway, liveValues: "[REDACTED]", testValues: "[REDACTED]" } })
  } catch (err) { next(err) }
}

export async function updatePaymentGateway(req, res, next) {
  try {
    const { id } = req.params
    const data = createPaymentGatewaySchema.partial().parse(req.body)
    const gateway = await prisma.paymentGateway.update({ where: { id }, data })
    res.json({ success: true, data: { ...gateway, liveValues: "[REDACTED]", testValues: "[REDACTED]" } })
  } catch (err) { next(err) }
}

export async function deletePaymentGateway(req, res, next) {
  try {
    const { id } = req.params
    await prisma.paymentGateway.delete({ where: { id } })
    res.json({ success: true, message: "Payment gateway deleted" })
  } catch (err) { next(err) }
}

export async function togglePaymentGateway(req, res, next) {
  try {
    const { id } = req.params
    const gateway = await prisma.paymentGateway.findUnique({ where: { id } })
    if (!gateway) return res.status(404).json({ success: false, message: "Gateway not found" })
    const updated = await prisma.paymentGateway.update({
      where: { id },
      data: { isActive: !gateway.isActive },
    })
    res.json({ success: true, data: { ...updated, liveValues: "[REDACTED]", testValues: "[REDACTED]" } })
  } catch (err) { next(err) }
}

// --- Payment Initiation ---

export async function initiatePayment(req, res, next) {
  try {
    const data = initiatePaymentSchema.parse(req.body)

    const gateway = await prisma.paymentGateway.findFirst({
      where: { gateway: data.gateway, isActive: true },
    })
    if (!gateway) return res.status(404).json({ success: false, message: "Payment gateway not found or inactive" })

    const config = gateway.mode === "live" ? gateway.liveValues : gateway.testValues
    if (!config) return res.status(400).json({ success: false, message: "Gateway configuration missing" })

    // Never trust a client-supplied amount: resolve it from the actual order balance.
    let order = null
    let amount = data.amount
    if (data.orderId) {
      order = await prisma.order.findUnique({ where: { id: data.orderId } })
      if (!order) return res.status(404).json({ success: false, message: "Order not found" })
      if (order.createdById !== req.user?.id && !["SUPER_ADMIN", "FINANCE"].includes(req.user?.role)) {
        return res.status(403).json({ success: false, message: "You do not have access to this order" })
      }

      const alreadyPaid = await prisma.payment.aggregate({
        where: { orderId: order.id, status: "PAID" },
        _sum: { amount: true },
      })
      const outstanding = Number(order.totalAmount) - Number(alreadyPaid._sum.amount || 0)
      if (outstanding <= 0) {
        return res.status(400).json({ success: false, message: "Order is already fully paid" })
      }
      amount = Math.min(data.amount, outstanding)
    }

    // Our own reference, generated up front, is what we hand the gateway as its
    // order_id/reference — every webhook is then looked up by this single indexed
    // field instead of guessing at a client-controlled identifier.
    const reference = `PRQ-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`

    let paymentRequest = await prisma.paymentRequest.create({
      data: {
        paymentGatewayId: gateway.id,
        orderId: order?.id || null,
        payerId: req.user?.id,
        paymentAmount: amount,
        currencyCode: data.currency,
        reference,
        status: "PENDING",
        payerInformation: {
          phone: data.payerPhone,
          email: data.payerEmail,
          name: data.payerName,
        },
        paymentPlatform: data.gateway,
      },
    })

    let paymentResult
    try {
      switch (data.gateway.toLowerCase()) {
        case "selcom":
          paymentResult = await initiateSelcomPayment({ ...data, amount }, config, reference)
          break
        case "azampesa":
          paymentResult = await initiateAzampesaPayment({ ...data, amount }, config, reference)
          break
        default:
          await prisma.paymentRequest.delete({ where: { id: paymentRequest.id } })
          return res.status(400).json({ success: false, message: `Unsupported gateway: ${data.gateway}` })
      }
    } catch (gatewayErr) {
      await prisma.paymentRequest.update({
        where: { id: paymentRequest.id },
        data: { status: "FAILED", additionalData: { error: gatewayErr.message } },
      })
      throw gatewayErr
    }

    paymentRequest = await prisma.paymentRequest.update({
      where: { id: paymentRequest.id },
      data: {
        externalRedirectLink: paymentResult.redirectUrl || null,
        additionalData: paymentResult.additionalData || null,
      },
    })

    res.json({ success: true, data: { paymentRequestId: paymentRequest.id, ...paymentResult } })
  } catch (err) { next(err) }
}

// --- Poll payment status (used by clients instead of assuming success) ---

export async function getPaymentRequestStatus(req, res, next) {
  try {
    const { id } = req.params
    const paymentRequest = await prisma.paymentRequest.findUnique({ where: { id } })
    if (!paymentRequest) return res.status(404).json({ success: false, message: "Payment request not found" })

    if (
      paymentRequest.payerId &&
      req.user?.id !== paymentRequest.payerId &&
      !["SUPER_ADMIN", "FINANCE"].includes(req.user?.role)
    ) {
      return res.status(403).json({ success: false, message: "You do not have access to this payment request" })
    }

    res.json({
      success: true,
      data: {
        paymentRequestId: paymentRequest.id,
        status: paymentRequest.status,
        isPaid: paymentRequest.isPaid,
        amount: paymentRequest.paymentAmount,
        currency: paymentRequest.currencyCode,
        orderId: paymentRequest.orderId,
      },
    })
  } catch (err) { next(err) }
}

// --- Selcom Payment Integration (Collection API) ---
// Uses Selcom Push USSD flow: create-order-minimal → wallet-payment/selcompesa-payment

function generateSelcomHeaders(apiKey, apiSecret, requestData, signedFields) {
  const timestamp = new Date().toISOString()
  const authorization = Buffer.from(apiKey).toString("hex")

  const fields = signedFields.split(",")
  let signingString = `timestamp=${timestamp}`
  fields.forEach(f => {
    signingString += `&${f}=${requestData[f] || ""}`
  })

  const digest = crypto
    .createHmac("sha256", apiSecret)
    .update(signingString)
    .digest("base64")

  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": `SELCOM ${authorization}`,
    "Digest-Method": "HS256",
    "Digest": digest,
    "Timestamp": timestamp,
    "Signed-Fields": signedFields,
  }
}

// Selcom signs webhooks the same way it requires requests to be signed: an HMAC-SHA256
// digest over `timestamp=...&field=value...` for the fields named in Signed-Fields,
// using the merchant's secret key. Recompute it and compare in constant time.
function verifySelcomWebhookSignature(req, secretKey) {
  const signedFieldsHeader = req.headers["signed-fields"]
  const digestHeader = req.headers["digest"]
  const timestampHeader = req.headers["timestamp"]
  if (!signedFieldsHeader || !digestHeader || !timestampHeader || !secretKey) return false

  const fields = signedFieldsHeader.split(",")
  let signingString = `timestamp=${timestampHeader}`
  fields.forEach(f => {
    signingString += `&${f}=${req.body?.[f] ?? ""}`
  })

  const expectedDigest = crypto.createHmac("sha256", secretKey).update(signingString).digest("base64")

  try {
    return crypto.timingSafeEqual(Buffer.from(expectedDigest), Buffer.from(digestHeader))
  } catch {
    return false
  }
}

async function initiateSelcomPayment(data, config, reference) {
  const {
    SELCOM_BASE_URL,
    SELCOM_VENDOR,
    SELCOM_API_KEY,
    SELCOM_SECRET_KEY,
  } = config

  if (!SELCOM_BASE_URL || !SELCOM_VENDOR || !SELCOM_API_KEY || !SELCOM_SECRET_KEY) {
    throw new Error("Selcom configuration incomplete")
  }

  const orderId = reference
  const buyerName = data.payerName || "Customer"
  const buyerPhone = data.payerPhone || ""
  const buyerEmail = data.payerEmail || ""
  const paymentChannel = data.paymentChannel || "wallet" // wallet | selcompesa

  // Step 1: Create order minimal
  const orderData = {
    vendor: SELCOM_VENDOR,
    order_id: orderId,
    buyer_email: buyerEmail,
    buyer_name: buyerName,
    buyer_user_id: data.payerPhone || "guest",
    buyer_phone: buyerPhone,
    amount: data.amount,
    currency: data.currency,
    redirect_url: data.redirectUrl || "",
    cancel_url: data.cancelUrl || "",
    webhook: data.webhookUrl || "",
    buyer_remarks: "None",
    merchant_remarks: "None",
    no_of_items: 1,
  }

  const orderSignedFields = "vendor,order_id,buyer_email,buyer_name,buyer_user_id,buyer_phone,amount,currency,redirect_url,cancel_url,webhook,buyer_remarks,merchant_remarks,no_of_items"
  const orderHeaders = generateSelcomHeaders(SELCOM_API_KEY, SELCOM_SECRET_KEY, orderData, orderSignedFields)

  const orderResponse = await fetch(`${SELCOM_BASE_URL}/checkout/create-order-minimal`, {
    method: "POST",
    headers: orderHeaders,
    body: JSON.stringify(orderData),
  })

  const orderResult = await orderResponse.json()

  if (orderResult.result !== "SUCCESS") {
    throw new Error(`Selcom order creation failed: ${orderResult.message || JSON.stringify(orderResult)}`)
  }

  // Step 2: Push USSD payment (wallet-payment or selcompesa-payment)
  const transid = `${reference}-TXN`
  const paymentData = {
    transid,
    order_id: orderId,
    msisdn: buyerPhone,
  }

  const paymentSignedFields = "transid,order_id,msisdn"
  const paymentHeaders = generateSelcomHeaders(SELCOM_API_KEY, SELCOM_SECRET_KEY, paymentData, paymentSignedFields)

  const paymentEndpoint = paymentChannel === "selcompesa" ? "/checkout/selcompesa-payment" : "/checkout/wallet-payment"
  const paymentResponse = await fetch(`${SELCOM_BASE_URL}${paymentEndpoint}`, {
    method: "POST",
    headers: paymentHeaders,
    body: JSON.stringify(paymentData),
  })

  const paymentResult = await paymentResponse.json()

  return {
    redirectUrl: orderResult.data?.[0]?.payment_gateway_url || null,
    additionalData: {
      orderId,
      transid,
      paymentChannel,
      orderResult,
      paymentResult,
    },
  }
}

// --- Selcom Order Status Check ---
export async function getSelcomOrderStatus(req, res, next) {
  try {
    const { orderId } = req.query
    if (!orderId) return res.status(400).json({ success: false, message: "orderId is required" })

    const gateway = await prisma.paymentGateway.findFirst({
      where: { gateway: "selcom", isActive: true },
    })
    if (!gateway) return res.status(404).json({ success: false, message: "Selcom gateway not found or inactive" })

    const config = gateway.mode === "live" ? gateway.liveValues : gateway.testValues
    const { SELCOM_BASE_URL, SELCOM_API_KEY, SELCOM_SECRET_KEY } = config

    const queryParams = { order_id: orderId }
    const signedFields = "order_id"
    const headers = generateSelcomHeaders(SELCOM_API_KEY, SELCOM_SECRET_KEY, queryParams, signedFields)

    const response = await fetch(`${SELCOM_BASE_URL}/checkout/order-status?order_id=${orderId}`, {
      method: "GET",
      headers,
    })

    const result = await response.json()
    res.json({ success: true, data: result })
  } catch (err) { next(err) }
}

// --- Selcom Cancel Order ---
export async function cancelSelcomOrder(req, res, next) {
  try {
    const { orderId } = req.query
    if (!orderId) return res.status(400).json({ success: false, message: "orderId is required" })

    const gateway = await prisma.paymentGateway.findFirst({
      where: { gateway: "selcom", isActive: true },
    })
    if (!gateway) return res.status(404).json({ success: false, message: "Selcom gateway not found or inactive" })

    const config = gateway.mode === "live" ? gateway.liveValues : gateway.testValues
    const { SELCOM_BASE_URL, SELCOM_API_KEY, SELCOM_SECRET_KEY } = config

    const queryParams = { order_id: orderId }
    const signedFields = "order_id"
    const headers = generateSelcomHeaders(SELCOM_API_KEY, SELCOM_SECRET_KEY, queryParams, signedFields)

    const response = await fetch(`${SELCOM_BASE_URL}/checkout/cancel-order?order_id=${orderId}`, {
      method: "DELETE",
      headers,
    })

    const result = await response.json()
    res.json({ success: true, data: result })
  } catch (err) { next(err) }
}

// --- Azampesa Payment Integration ---
// Based on drivemond AzampesaController
async function initiateAzampesaPayment(data, config, reference) {
  const {
    AZAMPESA_BASE_URL,
    AZAMPESA_CLIENT_ID,
    AZAMPESA_CLIENT_SECRET,
    AZAMPESA_CALLBACK_URL,
  } = config

  if (!AZAMPESA_BASE_URL || !AZAMPESA_CLIENT_ID || !AZAMPESA_CLIENT_SECRET) {
    throw new Error("Azampesa configuration incomplete")
  }

  // Step 1: Get access token
  const tokenResponse = await fetch(`${AZAMPESA_BASE_URL}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: AZAMPESA_CLIENT_ID,
      client_secret: AZAMPESA_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  })

  const tokenData = await tokenResponse.json()
  const accessToken = tokenData.access_token

  if (!accessToken) {
    throw new Error("Failed to get Azampesa access token")
  }

  // Step 2: Initiate payment
  const paymentReference = reference
  const paymentData = {
    reference: paymentReference,
    amount: data.amount,
    currency: data.currency,
    payer_phone: data.payerPhone,
    payer_name: data.payerName || "Customer",
    callback_url: AZAMPESA_CALLBACK_URL || data.webhookUrl,
    description: `Payment ${paymentReference}`,
  }

  const paymentResponse = await fetch(`${AZAMPESA_BASE_URL}/api/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify(paymentData),
  })

  const result = await paymentResponse.json()

  return {
    redirectUrl: result.data?.payment_url || null,
    additionalData: { paymentReference, azampesaResponse: result },
  }
}

// AzamPesa doesn't document a fixed signature scheme in this codebase's integration notes,
// so we verify an HMAC-SHA256 of the raw request body against the gateway's client secret,
// accepting it from either a dedicated signature header or a Bearer Authorization header.
function verifyAzampesaWebhookSignature(req, secretKey) {
  const signatureHeader = req.headers["x-azampesa-signature"] || req.headers["x-signature"]
  if (!signatureHeader || !secretKey) return false

  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}))
  const expected = crypto.createHmac("sha256", secretKey).update(raw).digest("hex")

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signatureHeader)))
  } catch {
    return false
  }
}

// --- Shared: apply a confirmed payment atomically to its payment request + order + shipments ---
async function applyConfirmedPayment(paymentRequest, { transactionId, method, metadata }) {
  let confirmedOrder = null
  await prisma.$transaction(async (tx) => {
    await tx.paymentRequest.update({
      where: { id: paymentRequest.id },
      data: { isPaid: true, status: "PAID" },
    })

    if (!paymentRequest.orderId) return

    const order = await tx.order.findUnique({ where: { id: paymentRequest.orderId } })
    if (!order) return
    confirmedOrder = order

    await tx.payment.create({
      data: {
        paymentRef: paymentRequest.reference,
        orderId: order.id,
        payerId: paymentRequest.payerId,
        amount: paymentRequest.paymentAmount,
        currency: paymentRequest.currencyCode,
        method: method || "MOBILE_MONEY",
        status: "PAID",
        transactionId: transactionId || paymentRequest.reference,
        paidAt: new Date(),
        metadata: metadata || null,
      },
    })

    const totalPaid = await tx.payment.aggregate({
      where: { orderId: order.id, status: "PAID" },
      _sum: { amount: true },
    })
    const paidAmount = Number(totalPaid._sum.amount || 0)
    const newPaymentStatus = paidAmount >= Number(order.totalAmount) ? "PAID" : "PARTIAL"

    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: newPaymentStatus } })

    if (newPaymentStatus === "PAID") {
      await tx.shipment.updateMany({
        where: { orderId: order.id },
        data: { paymentStatus: "PAID", status: "PAYMENT_CONFIRMED" },
      })
    }
  })

  if (paymentRequest.payerId) {
    try {
      const shipment = paymentRequest.orderId
        ? await prisma.shipment.findFirst({ where: { orderId: paymentRequest.orderId } })
        : null
      await createNotification(
        paymentRequest.payerId,
        "PAYMENT_CONFIRMED",
        "Payment Confirmed",
        shipment
          ? `Your payment for shipment ${shipment.trackingNumber} has been confirmed successfully.`
          : "Your payment has been confirmed successfully.",
        shipment ? { shipmentId: shipment.id, trackingNumber: shipment.trackingNumber } : {}
      )
    } catch (notifErr) {
      console.warn("Payment gateway notification failed:", notifErr.message)
    }
  }

  if (confirmedOrder) {
    await emitEvent(EVENTS.PAYMENT_SUCCESS, {
      order_id: confirmedOrder.id,
      order_number: confirmedOrder.orderNumber,
      amount: Number(paymentRequest.paymentAmount),
      currency: paymentRequest.currencyCode,
    }, confirmedOrder.partnerId ? { partnerId: confirmedOrder.partnerId } : {})
  }
}

async function emitPaymentFailedEvent(paymentRequest) {
  let partnerId
  if (paymentRequest.orderId) {
    const order = await prisma.order.findUnique({ where: { id: paymentRequest.orderId }, select: { id: true, orderNumber: true, partnerId: true } })
    if (order) {
      await emitEvent(EVENTS.PAYMENT_FAILED, {
        order_id: order.id,
        order_number: order.orderNumber,
        amount: Number(paymentRequest.paymentAmount),
        currency: paymentRequest.currencyCode,
      }, order.partnerId ? { partnerId: order.partnerId } : {})
      return
    }
  }
  await emitEvent(EVENTS.PAYMENT_FAILED, { payment_request_id: paymentRequest.id, amount: Number(paymentRequest.paymentAmount), currency: paymentRequest.currencyCode })
}

// --- Payment Webhook/Callback Handlers ---

export async function selcomWebhook(req, res, next) {
  try {
    const { order_id, payment_status, transid, reference, channel, amount, phone, resultcode } = req.body

    if (!order_id) {
      return res.status(400).json({ success: false, message: "Missing order_id" })
    }

    const paymentRequest = await prisma.paymentRequest.findUnique({ where: { reference: order_id } })
    if (!paymentRequest) {
      return res.status(404).json({ success: false, message: "Payment request not found" })
    }

    const gateway = paymentRequest.paymentGatewayId
      ? await prisma.paymentGateway.findUnique({ where: { id: paymentRequest.paymentGatewayId } })
      : null
    const config = gateway ? (gateway.mode === "live" ? gateway.liveValues : gateway.testValues) : null
    const secret = config?.SELCOM_SECRET_KEY

    const signatureValid = verifySelcomWebhookSignature(req, secret)
    if (!signatureValid) {
      // Live gateways must always verify. Test-mode gateways are allowed through (with a
      // loud warning) so integrations can be exercised against sandboxes that don't sign.
      if (gateway?.mode !== "test") {
        console.warn(`Selcom webhook signature verification failed for order ${order_id}`)
        return res.status(401).json({ success: false, message: "Invalid webhook signature" })
      }
      console.warn(`Selcom webhook signature could not be verified (test mode, proceeding) for order ${order_id}`)
    }

    // Idempotency: a retried/duplicate webhook must never re-process a completed payment.
    if (paymentRequest.status === "PAID") {
      return res.json({ success: true, message: "Webhook already processed" })
    }

    const isSuccess = payment_status === "COMPLETED" || payment_status === "SUCCESS"
    const isFailure = payment_status === "FAILED" || payment_status === "CANCELLED" || resultcode === "FAIL"

    if (isSuccess) {
      const paidAmount = Number(amount)
      if (Number.isFinite(paidAmount) && Math.abs(paidAmount - Number(paymentRequest.paymentAmount)) > 0.5) {
        console.error(`Selcom webhook amount mismatch for ${order_id}: expected ${paymentRequest.paymentAmount}, got ${amount}`)
        await prisma.paymentRequest.update({
          where: { id: paymentRequest.id },
          data: {
            status: "FAILED",
            additionalData: { ...paymentRequest.additionalData, webhookData: req.body, error: "amount_mismatch" },
          },
        })
        return res.status(400).json({ success: false, message: "Amount mismatch" })
      }

      await prisma.paymentRequest.update({
        where: { id: paymentRequest.id },
        data: { additionalData: { ...paymentRequest.additionalData, webhookData: req.body } },
      })

      await applyConfirmedPayment(paymentRequest, {
        transactionId: transid || reference,
        method: "MOBILE_MONEY",
        metadata: { gateway: "selcom", channel, phone },
      })
    } else if (isFailure) {
      await prisma.paymentRequest.update({
        where: { id: paymentRequest.id },
        data: { status: "FAILED", additionalData: { ...paymentRequest.additionalData, webhookData: req.body } },
      })
      await emitPaymentFailedEvent(paymentRequest)
    }

    res.json({ success: true, message: "Webhook processed" })
  } catch (err) { next(err) }
}

export async function azampesaCallback(req, res, next) {
  try {
    const { reference, status, amount, transactionId } = req.body

    if (!reference) {
      return res.status(400).json({ success: false, message: "Missing reference" })
    }

    const paymentRequest = await prisma.paymentRequest.findUnique({ where: { reference } })
    if (!paymentRequest) {
      return res.status(404).json({ success: false, message: "Payment request not found" })
    }

    const gateway = paymentRequest.paymentGatewayId
      ? await prisma.paymentGateway.findUnique({ where: { id: paymentRequest.paymentGatewayId } })
      : null
    const config = gateway ? (gateway.mode === "live" ? gateway.liveValues : gateway.testValues) : null
    const secret = config?.AZAMPESA_CLIENT_SECRET

    const signatureValid = verifyAzampesaWebhookSignature(req, secret)
    if (!signatureValid) {
      if (gateway?.mode !== "test") {
        console.warn(`AzamPesa webhook signature verification failed for reference ${reference}`)
        return res.status(401).json({ success: false, message: "Invalid webhook signature" })
      }
      console.warn(`AzamPesa webhook signature could not be verified (test mode, proceeding) for reference ${reference}`)
    }

    if (paymentRequest.status === "PAID") {
      return res.json({ success: true, message: "Callback already processed" })
    }

    const isSuccess = status === "SUCCESS" || status === "COMPLETED"
    const isFailure = status === "FAILED" || status === "CANCELLED"

    if (isSuccess) {
      if (amount !== undefined) {
        const paidAmount = Number(amount)
        if (Number.isFinite(paidAmount) && Math.abs(paidAmount - Number(paymentRequest.paymentAmount)) > 0.5) {
          console.error(`AzamPesa callback amount mismatch for ${reference}`)
          await prisma.paymentRequest.update({
            where: { id: paymentRequest.id },
            data: {
              status: "FAILED",
              additionalData: { ...paymentRequest.additionalData, webhookData: req.body, error: "amount_mismatch" },
            },
          })
          return res.status(400).json({ success: false, message: "Amount mismatch" })
        }
      }

      await prisma.paymentRequest.update({
        where: { id: paymentRequest.id },
        data: { additionalData: { ...paymentRequest.additionalData, webhookData: req.body } },
      })

      await applyConfirmedPayment(paymentRequest, {
        transactionId: transactionId || reference,
        method: "MOBILE_MONEY",
        metadata: { gateway: "azampesa" },
      })
    } else if (isFailure) {
      await prisma.paymentRequest.update({
        where: { id: paymentRequest.id },
        data: { status: "FAILED", additionalData: { ...paymentRequest.additionalData, webhookData: req.body } },
      })
      await emitPaymentFailedEvent(paymentRequest)
    }

    res.json({ success: true, message: "Callback processed" })
  } catch (err) { next(err) }
}

// --- Get active gateways for customer app ---

export async function getActiveGateways(req, res, next) {
  try {
    const gateways = await prisma.paymentGateway.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        gateway: true,
        mode: true,
        additionalData: true,
      },
    })
    res.json({ success: true, data: gateways })
  } catch (err) { next(err) }
}
