import prisma from "../../prisma/client.js"
import { createPaymentGatewaySchema, initiatePaymentSchema } from "./validation.js"
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

    let paymentResult

    switch (data.gateway.toLowerCase()) {
      case "selcom":
        paymentResult = await initiateSelcomPayment(data, config)
        break
      case "azampesa":
        paymentResult = await initiateAzampesaPayment(data, config)
        break
      default:
        return res.status(400).json({ success: false, message: `Unsupported gateway: ${data.gateway}` })
    }

    // Create payment request record
    const paymentRequest = await prisma.paymentRequest.create({
      data: {
        paymentGatewayId: gateway.id,
        payerId: req.user?.id,
        paymentAmount: data.amount,
        currencyCode: data.currency,
        payerInformation: {
          phone: data.payerPhone,
          email: data.payerEmail,
          name: data.payerName,
        },
        externalRedirectLink: paymentResult.redirectUrl || null,
        paymentPlatform: data.gateway,
        additionalData: paymentResult.additionalData || null,
      },
    })

    res.json({ success: true, data: { paymentRequestId: paymentRequest.id, ...paymentResult } })
  } catch (err) { next(err) }
}

// --- Selcom Payment Integration ---
// Based on drivemond SelcomController
async function initiateSelcomPayment(data, config) {
  const {
    SELCOM_BASE_URL,
    SELCOM_VENDOR,
    SELCOM_API_KEY,
    SELCOM_SECRET_KEY,
  } = config

  if (!SELCOM_BASE_URL || !SELCOM_VENDOR || !SELCOM_API_KEY || !SELCOM_SECRET_KEY) {
    throw new Error("Selcom configuration incomplete")
  }

  const orderId = `ORD-${Date.now()}`
  const buyerName = data.payerName || "Customer"
  const buyerPhone = data.payerPhone || ""
  const buyerEmail = data.payerEmail || ""

  // Generate signed request (Selcom uses HMAC-SHA256)
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").split(".")[0]
  const signedFields = "order_id,version,timestamp,buyer_user_id,buyer_name,buyer_phone,buyer_email,amount,currency"
  const requestData = {
    vendor: SELCOM_VENDOR,
    order_id: orderId,
    version: "1.0",
    timestamp,
    buyer_user_id: data.payerPhone || "guest",
    buyer_name: buyerName,
    buyer_phone: buyerPhone,
    buyer_email: buyerEmail,
    amount: data.amount,
    currency: data.currency,
    redirect_url: data.redirectUrl || "",
    webhook_url: data.webhookUrl || "",
    no_of_items: "1",
  }

  // Generate HMAC-SHA256 signature
  const signedValues = signedFields.split(",").map(f => requestData[f] || "").join(",")
  const signature = crypto
    .createHmac("sha256", SELCOM_SECRET_KEY)
    .update(signedValues)
    .digest("base64")

  const response = await fetch(`${SELCOM_BASE_URL}/checkout/order/create_and_pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `SELCOM ${SELCOM_API_KEY}:${signature}`,
      "Signed-Fields": signedFields,
    },
    body: JSON.stringify(requestData),
  })

  const result = await response.json()

  return {
    redirectUrl: result.data?.payment_url || result.data?.checkout_url || null,
    additionalData: { orderId, selcomResponse: result },
  }
}

// --- Azampesa Payment Integration ---
// Based on drivemond AzampesaController
async function initiateAzampesaPayment(data, config) {
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
  const paymentReference = `AZP-${Date.now()}`
  const paymentData = {
    reference: paymentReference,
    amount: data.amount,
    currency: data.currency,
    payer_phone: data.payerPhone,
    payer_name: data.payerName || "Customer",
    callback_url: AZAMPESA_CALLBACK_URL || data.webhookUrl,
    description: `Payment for order ${data.orderId}`,
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

// --- Payment Webhook/Callback Handlers ---

export async function selcomWebhook(req, res, next) {
  try {
    const { order_id, payment_status, transid } = req.body

    const paymentRequest = await prisma.paymentRequest.findFirst({
      where: { additionalData: { path: ["orderId"], equals: order_id } },
    })

    if (!paymentRequest) {
      return res.status(404).json({ success: false, message: "Payment request not found" })
    }

    if (payment_status === "COMPLETED" || payment_status === "SUCCESS") {
      await prisma.paymentRequest.update({
        where: { id: paymentRequest.id },
        data: { isPaid: true },
      })

      // Update related order payment status
      if (paymentRequest.payerId) {
        // Find and update the order
        const order = await prisma.order.findFirst({
          where: { payments: { some: { paymentRef: order_id } } },
        })
        if (order) {
          await prisma.order.update({
            where: { id: order.id },
            data: { paymentStatus: "PAID" },
          })
        }
      }
    }

    res.json({ success: true, message: "Webhook processed" })
  } catch (err) { next(err) }
}

export async function azampesaCallback(req, res, next) {
  try {
    const { reference, status } = req.body

    const paymentRequest = await prisma.paymentRequest.findFirst({
      where: { additionalData: { path: ["paymentReference"], equals: reference } },
    })

    if (!paymentRequest) {
      return res.status(404).json({ success: false, message: "Payment request not found" })
    }

    if (status === "SUCCESS" || status === "COMPLETED") {
      await prisma.paymentRequest.update({
        where: { id: paymentRequest.id },
        data: { isPaid: true },
      })
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
