import prisma from "../../prisma/client.js"
import { createNotification } from "../notifications/controller.js"

const SMS_PROVIDER = process.env.SMS_PROVIDER || "africas_talking"
const SMS_API_KEY = process.env.SMS_API_KEY || ""
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || "XERIN"
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || "smtp"
const EMAIL_API_KEY = process.env.EMAIL_API_KEY || ""

const STATUS_MESSAGES = {
  BOOKED: { title: "Booking Confirmed", message: "Your shipment has been booked successfully. Tracking: {tracking}" },
  PICKED_UP: { title: "Parcel Picked Up", message: "Your parcel has been picked up by our driver. Tracking: {tracking}" },
  IN_TRANSIT: { title: "Parcel In Transit", message: "Your parcel is now in transit. Track live: {tracking}" },
  WAREHOUSE: { title: "Received at Station", message: "Your parcel has arrived at {station} station. Tracking: {tracking}" },
  ARRIVED_DESTINATION: { title: "Arrived at Destination", message: "Your parcel has arrived at the destination station. Tracking: {tracking}" },
  OUT_FOR_DELIVERY: { title: "Out for Delivery", message: "Your parcel is out for delivery. Be ready to receive it. Tracking: {tracking}" },
  DELIVERED: { title: "Parcel Delivered", message: "Your parcel has been delivered successfully. Tracking: {tracking}" },
  DELIVERY_FAILED: { title: "Delivery Failed", message: "Delivery attempt failed. We will retry. Tracking: {tracking}" },
  RETURNING: { title: "Parcel Returning", message: "Your parcel is being returned. Contact support for details. Tracking: {tracking}" },
  RETURNED: { title: "Parcel Returned", message: "Your parcel has been returned to origin. Tracking: {tracking}" },
  CANCELLED: { title: "Shipment Cancelled", message: "Your shipment has been cancelled. Tracking: {tracking}" },
}

export async function sendNotification(userId, status, shipmentData, channels = ["IN_APP"]) {
  try {
    const template = STATUS_MESSAGES[status]
    if (!template) return

    const message = template.message
      .replace("{tracking}", shipmentData.trackingNumber || "")
      .replace("{station}", shipmentData.stationName || "")

    const title = template.title

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, name: true },
    })
    if (!user) return

    for (const channel of channels) {
      if (channel === "IN_APP") {
        await createNotification(userId, status, title, message, { shipmentId: shipmentData.id })
      }

      if (channel === "SMS" && user.phone) {
        await sendSMS(user.phone, message, userId)
      }

      if (channel === "EMAIL" && user.email) {
        await sendEmail(user.email, title, message, userId)
      }

      if (channel === "PUSH") {
        await sendPushNotification(userId, title, message)
      }
    }
  } catch (err) {
    console.error("Notification error:", err.message)
  }
}

async function sendSMS(phone, message, userId) {
  try {
    let providerId = null
    let success = false

    if (SMS_PROVIDER === "africas_talking" && SMS_API_KEY) {
      const response = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
          "apiKey": SMS_API_KEY,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          username: process.env.SMS_USERNAME || "xerin",
          to: phone,
          message: message,
          from: SMS_SENDER_ID,
        }),
      })
      const data = await response.json()
      providerId = data.SMSMessageData?.MessageId || null
      success = response.ok
    } else {
      console.log(`[SMS Mock] To: ${phone}, Message: ${message}`)
      success = true
    }

    await prisma.notificationLog.create({
      data: {
        recipient: phone,
        channel: "SMS",
        provider: SMS_PROVIDER,
        providerId,
        status: success ? "SENT" : "FAILED",
        sentAt: success ? new Date() : null,
      },
    })
  } catch (err) {
    console.error("SMS send error:", err.message)
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

async function sendEmail(email, subject, body, userId) {
  try {
    let success = false

    if (EMAIL_PROVIDER === "sendgrid" && EMAIL_API_KEY) {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${EMAIL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: "noreply@xerinexpress.com", name: "Xerin Delivery Express" },
          subject,
          content: [{ type: "text/plain", value: body }],
        }),
      })
      success = response.ok
    } else {
      console.log(`[EMAIL Mock] To: ${email}, Subject: ${subject}`)
      success = true
    }

    await prisma.notificationLog.create({
      data: {
        recipient: email,
        channel: "EMAIL",
        provider: EMAIL_PROVIDER,
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
        provider: EMAIL_PROVIDER,
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
    const channels = ["IN_APP", "SMS", "PUSH"]

    await sendNotification(userId, newStatus, {
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
      stationName,
    }, channels)
  } catch (err) {
    console.error("Trigger notification error:", err.message)
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
      for (const channel of channels) {
        if (channel === "IN_APP") {
          await createNotification(userId, "BULK", title, message, null)
        }
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true, email: true } })
        if (channel === "SMS" && user?.phone) {
          await sendSMS(user.phone, message, userId)
        }
        if (channel === "EMAIL" && user?.email) {
          await sendEmail(user.email, title, message, userId)
        }
      }
      results.push({ userId, status: "sent" })
    }

    res.json({ success: true, data: results, message: `Notification sent to ${userIds.length} users` })
  } catch (err) { next(err) }
}
