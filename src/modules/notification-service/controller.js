import prisma from "../../prisma/client.js"
import { createNotification } from "../notifications/controller.js"
import nodemailer from "nodemailer"
import { sendSms } from "../auth/sms.service.js"

const SMS_PROVIDER = process.env.SMS_PROVIDER || "mshastra"

let emailTransporter = null

function getEmailTransporter() {
  if (!emailTransporter) {
    emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "465"),
      secure: parseInt(process.env.SMTP_PORT || "465") === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { rejectUnauthorized: false },
    })
  }
  return emailTransporter
}

const EMAIL_WRAPPER = (content) => `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: linear-gradient(135deg, #E8732A 0%, #F2905A 100%); padding: 32px 24px; text-align: center;">
      <h1 style="color: #ffffff; font-size: 26px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">Xerin Express</h1>
      <p style="color: rgba(255,255,255,0.8); font-size: 13px; margin: 6px 0 0 0;">Deliver smarter, ship faster</p>
    </div>
    <div style="padding: 32px 24px;">
      ${content}
    </div>
    <div style="background: #f8f9fa; padding: 20px 24px; text-align: center;">
      <p style="color: #999; font-size: 12px; margin: 0;">
        Xerin Express &copy; ${new Date().getFullYear()}. All rights reserved.<br/>
        <a href="mailto:support@xerinexpress.com" style="color: #E8732A; text-decoration: none;">support@xerinexpress.com</a> &nbsp;|&nbsp; +255 700 000 000
      </p>
    </div>
  </div>
`

const STATUS_CONFIG = {
  BOOKED: {
    title: "Booking Confirmed",
    message: "Your shipment {tracking} has been booked successfully. We'll notify you when it's picked up.",
    channels: ["IN_APP", "EMAIL", "SMS"],
    icon: "check_circle",
  },
  PICKED_UP: {
    title: "Parcel Picked Up",
    message: "Great news! Your parcel {tracking} has been picked up by our driver and is on its way.",
    channels: ["IN_APP", "EMAIL", "SMS"],
    icon: "inventory",
  },
  IN_TRANSIT: {
    title: "Parcel In Transit",
    message: "Your parcel {tracking} is now in transit. You can track it live in the app.",
    channels: ["IN_APP", "EMAIL", "SMS"],
    icon: "local_shipping",
  },
  WAREHOUSE: {
    title: "Arrived at Station",
    message: "Your parcel {tracking} has arrived at {station} station for processing.",
    channels: ["IN_APP", "EMAIL"],
    icon: "warehouse",
  },
  ARRIVED_DESTINATION: {
    title: "Arrived at Destination",
    message: "Your parcel {tracking} has arrived at the destination station. Out for delivery soon.",
    channels: ["IN_APP", "EMAIL", "SMS"],
    icon: "location_on",
  },
  OUT_FOR_DELIVERY: {
    title: "Out for Delivery",
    message: "Your parcel {tracking} is out for delivery! Please be ready to receive it.",
    channels: ["IN_APP", "EMAIL", "SMS"],
    icon: "delivery_dining",
  },
  DELIVERED: {
    title: "Parcel Delivered",
    message: "Your parcel {tracking} has been delivered successfully. Thank you for choosing Xerin Express!",
    channels: ["IN_APP", "EMAIL", "SMS"],
    icon: "task_alt",
  },
  DELIVERY_FAILED: {
    title: "Delivery Failed",
    message: "Delivery attempt for {tracking} failed. We will retry. Contact support if needed.",
    channels: ["IN_APP", "EMAIL", "SMS"],
    icon: "error",
  },
  RETURNING: {
    title: "Parcel Returning",
    message: "Your parcel {tracking} is being returned to origin. Contact support for details.",
    channels: ["IN_APP", "EMAIL"],
    icon: "undo",
  },
  RETURNED: {
    title: "Parcel Returned",
    message: "Your parcel {tracking} has been returned to the origin address.",
    channels: ["IN_APP", "EMAIL", "SMS"],
    icon: "keyboard_return",
  },
  CANCELLED: {
    title: "Shipment Cancelled",
    message: "Your shipment {tracking} has been cancelled. Refund (if applicable) will be processed within 3-5 business days.",
    channels: ["IN_APP", "EMAIL", "SMS"],
    icon: "cancel",
  },
  PAYMENT_RECEIVED: {
    title: "Payment Received",
    message: "We've received your payment for shipment {tracking}. Your receipt is available in the app.",
    channels: ["IN_APP", "EMAIL"],
    icon: "payments",
  },
  DRIVER_ASSIGNED: {
    title: "Driver Assigned",
    message: "A driver has been assigned to your shipment {tracking}. You can contact them in the app.",
    channels: ["IN_APP", "EMAIL"],
    icon: "person",
  },
}

export async function sendNotification(userId, status, shipmentData, customChannels = null) {
  try {
    const config = STATUS_CONFIG[status]
    if (!config) return

    const message = config.message
      .replace("{tracking}", shipmentData.trackingNumber || "")
      .replace("{station}", shipmentData.stationName || "")

    const title = config.title
    const channels = customChannels || config.channels

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, name: true },
    })
    if (!user) return

    for (const channel of channels) {
      if (channel === "IN_APP") {
        await createNotification(userId, status, title, message, { shipmentId: shipmentData.id, icon: config.icon })
      }

      if (channel === "SMS" && user.phone) {
        await sendNotificationSMS(user.phone, message, userId)
      }

      if (channel === "EMAIL" && user.email) {
        await sendNotificationEmail(user.email, user.name, title, message, userId)
      }

      if (channel === "PUSH") {
        await sendPushNotification(userId, title, message)
      }
    }
  } catch (err) {
    console.error("Notification error:", err.message)
  }
}

async function sendNotificationSMS(phone, message, userId) {
  try {
    const smsMessage = `Xerin Express: ${message}`
    const result = await sendSms(phone, smsMessage)

    await prisma.notificationLog.create({
      data: {
        recipient: phone,
        channel: "SMS",
        provider: SMS_PROVIDER,
        providerId: result.providerId,
        status: "SENT",
        sentAt: new Date(),
      },
    })
  } catch (err) {
    console.error("[NOTIFICATION] SMS send error:", err.message)
    await prisma.notificationLog.create({
      data: {
        recipient: phone,
        channel: "SMS",
        provider: SMS_PROVIDER,
        status: "FAILED",
        errorMessage: err.message,
      },
    })
  }
}

async function sendNotificationEmail(email, name, subject, body, userId) {
  try {
    let success = false
    let providerId = null

    const htmlContent = EMAIL_WRAPPER(`
      <h2 style="color: #1a1a1a; font-size: 20px; margin: 0 0 16px 0;">${subject}</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; font-size: 15px; line-height: 1.6;">${body}</p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${process.env.CLIENT_URL || 'https://deliveryoptionfrontend-web.vercel.app'}/shipments" style="display: inline-block; background: #E8732A; color: #ffffff; font-size: 14px; font-weight: 700; padding: 12px 32px; border-radius: 10px; text-decoration: none;">Track Your Shipment</a>
      </div>
    `)

    if (process.env.SMTP_HOST) {
      const transport = getEmailTransporter()
      console.log(`[NOTIFICATION] Sending email to: ${email}, subject: ${subject}`)
      const info = await transport.sendMail({
        from: process.env.SMTP_FROM || "Xerin Express <contact@neg.co.tz>",
        to: email,
        subject: `${subject} - Xerin Express`,
        html: htmlContent,
      })
      providerId = info.messageId
      success = true
      console.log(`[NOTIFICATION] Email sent. MessageId: ${info.messageId}`)
    } else {
      console.log(`[EMAIL Mock] To: ${email}, Subject: ${subject}`)
      success = true
    }

    await prisma.notificationLog.create({
      data: {
        recipient: email,
        channel: "EMAIL",
        provider: "smtp",
        providerId,
        status: success ? "SENT" : "FAILED",
        sentAt: success ? new Date() : null,
      },
    })
  } catch (err) {
    console.error("Email send error:", err.message)
    await prisma.notificationLog.create({
      data: {
        recipient: email,
        channel: "EMAIL",
        provider: "smtp",
        status: "FAILED",
        errorMessage: err.message,
      },
    })
  }
}

async function sendPushNotification(userId, title, message) {
  try {
    await createNotification(userId, "PUSH", title, message, null)
    await prisma.notificationLog.create({
      data: {
        recipient: userId,
        channel: "PUSH",
        status: "SENT",
        sentAt: new Date(),
      },
    })
  } catch (err) {
    console.error("Push notification error:", err.message)
  }
}

export async function triggerStatusNotification(shipmentId, newStatus, stationName = null) {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, trackingNumber: true, createdById: true, customerId: true },
    })
    if (!shipment) return

    const userId = shipment.createdById
    const config = STATUS_CONFIG[newStatus]
    const channels = config ? config.channels : ["IN_APP", "EMAIL"]

    await sendNotification(userId, newStatus, {
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
      stationName,
    }, channels)
  } catch (err) {
    console.error("Trigger notification error:", err.message)
  }
}

export async function triggerPaymentNotification(shipmentId, amount, currency) {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, trackingNumber: true, createdById: true },
    })
    if (!shipment) return

    await sendNotification(shipment.createdById, "PAYMENT_RECEIVED", {
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
    })
  } catch (err) {
    console.error("Payment notification error:", err.message)
  }
}

export async function triggerDriverAssignedNotification(shipmentId, driverName) {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, trackingNumber: true, createdById: true },
    })
    if (!shipment) return

    await sendNotification(shipment.createdById, "DRIVER_ASSIGNED", {
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
    })
  } catch (err) {
    console.error("Driver assigned notification error:", err.message)
  }
}

export async function listNotificationLogs(req, res, next) {
  try {
    const { channel, status, page = 1, limit = 50 } = req.query
    const where = {}
    if (channel) where.channel = channel
    if (status) where.status = status

    const logs = await prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
    })
    const total = await prisma.notificationLog.count({ where })

    res.json({ success: true, data: logs, total })
  } catch (err) { next(err) }
}

export async function getNotificationStats(req, res, next) {
  try {
    const byChannel = await prisma.notificationLog.groupBy({
      by: ["channel"],
      _count: { channel: true },
    })
    const byStatus = await prisma.notificationLog.groupBy({
      by: ["status"],
      _count: { status: true },
    })
    const total = await prisma.notificationLog.count()

    res.json({ success: true, data: { total, byChannel, byStatus } })
  } catch (err) { next(err) }
}

export async function sendBulkNotification(req, res, next) {
  try {
    const { userIds, title, message, channels = ["IN_APP"] } = req.body
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: "userIds is required" })
    }

    const results = []
    for (const userId of userIds) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true, email: true, name: true } })
      if (!user) { results.push({ userId, status: "not_found" }); continue }

      for (const channel of channels) {
        if (channel === "IN_APP") {
          await createNotification(userId, "BULK", title, message, null)
        }
        if (channel === "SMS" && user.phone) {
          await sendNotificationSMS(user.phone, message, userId)
        }
        if (channel === "EMAIL" && user.email) {
          await sendNotificationEmail(user.email, user.name, title, message, userId)
        }
      }
      results.push({ userId, status: "sent" })
    }

    res.json({ success: true, data: results, message: `Notification sent to ${userIds.length} users` })
  } catch (err) { next(err) }
}
