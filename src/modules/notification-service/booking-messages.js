import prisma from "../../prisma/client.js"
import { createNotification } from "../notifications/controller.js"
import { queueMessage } from "../whatsapp/messaging-service.js"
import { sendNotificationEmail, sendNotificationSMS } from "./controller.js"

// What people are told the moment a booking is made — on every channel they have:
//   sender   -> in-app, email, SMS, WhatsApp: tracking code, route, vehicle, arrival window, price
//   receiver -> WhatsApp + SMS (they have no account): who is sending to them, arrival window and
//               THEIR confirmation code. The receiver hands that code over at delivery — the human
//               confirmation step. It is deliberately NOT put in the sender's message.
// Every channel is best-effort: a failed SMS or an offline WhatsApp never blocks the booking.

const TRACK_URL = (tn) => `${process.env.CLIENT_URL || "https://deliveryoptionfrontend-web.vercel.app"}/track/${tn}`
const money = (n, cur = "TZS") => `${cur} ${Math.round(Number(n || 0)).toLocaleString("en-US")}`

async function whatsappConnection() {
  return prisma.whatsAppConnection.findFirst({
    where: { isActive: true, status: "CONNECTED", OR: [{ purpose: "customer_care" }, { purpose: "operations" }, { purpose: null }] },
  })
}

async function sendWhatsApp(conn, { phone, name, body, shipmentId, eventType }) {
  if (!conn || !phone) return "SKIPPED"
  try {
    await queueMessage({ connectionId: conn.id, recipient: phone, recipientName: name, messageBody: body, shipmentId, eventType })
    return "QUEUED"
  } catch (err) {
    console.error(`[BOOKING MSG] WhatsApp to ${phone} failed:`, err.message)
    return "FAILED"
  }
}

async function attempt(label, fn) {
  try { return (await fn()) === false ? "FAILED" : "SENT" } catch (err) { console.error(`[BOOKING MSG] ${label} failed:`, err.message); return "FAILED" }
}

export function buildBookingTexts({ shipment, etaLabel }) {
  const from = shipment.fromAddress
  const to = shipment.toAddress
  const tn = shipment.trackingNumber
  const url = TRACK_URL(tn)
  const vehicle = shipment.vehicleClassName || shipment.vehicleCategory || shipment.transportMode
  const etaSw = etaLabel?.sw || "hivi karibuni"
  const etaEn = etaLabel?.en || "soon"

  const sender = {
    title: "Booking imethibitishwa / Booking confirmed",
    text:
      `Habari ${shipment.senderName}, booking yako imethibitishwa.\n` +
      `Namba ya mzigo: ${tn}\n` +
      `Njia: ${from.city} → ${to.city} (${vehicle})\n` +
      `Mzigo utamfikia mpokeaji: ${etaSw}\n` +
      `Mpokeaji: ${to.fullName}, ${to.phone}\n` +
      `Jumla: ${money(shipment.totalAmount, shipment.currency)}\n` +
      `Fuatilia: ${url}\n\n` +
      `Hi ${shipment.senderName}, your booking is confirmed. Tracking ${tn}, ${from.city} → ${to.city}, arrives ${etaEn}.`,
  }

  const receiver = shipment.otp ? {
    text:
      `Habari ${to.fullName}, ${from.fullName} anakutumia mzigo kupitia Xerin Express.\n` +
      `Namba ya mzigo: ${tn}\n` +
      `Kutoka: ${from.city} → ${to.city}\n` +
      `Unatarajiwa kufika: ${etaSw}\n` +
      `MSIMBO WA KUPOKEA: ${shipment.otp}\n` +
      `Mpe dereva au afisa wetu msimbo huu unapopokea mzigo tu — usimpe mtu mwingine.\n` +
      `Fuatilia: ${url}`,
  } : null

  return { sender, receiver }
}

export async function sendBookingMessages(shipmentId, { etaLabel } = {}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { fromAddress: true, toAddress: true, createdBy: { select: { id: true, name: true, email: true, phone: true } } },
  })
  if (!shipment) return null

  let vehicleClassName = null
  if (shipment.vehicleCategory) {
    const vc = await prisma.vehicleClass.findFirst({ where: { OR: [{ code: shipment.vehicleCategory }, { vehicleType: shipment.vehicleCategory }] }, select: { name: true } })
    vehicleClassName = vc?.name || null
  }

  const user = shipment.createdBy
  const { sender, receiver } = buildBookingTexts({
    shipment: { ...shipment, vehicleClassName, senderName: user?.name || shipment.fromAddress.fullName },
    etaLabel,
  })

  const conn = await whatsappConnection()
  const result = { sender: {}, receiver: {} }

  if (user) {
    result.sender.inApp = await attempt("in-app", () => createNotification(user.id, "BOOKING_CONFIRMED", sender.title, sender.text.split("\n").slice(0, 5).join(" · "), { shipmentId: shipment.id }))
    if (user.email) result.sender.email = await attempt("email", () => sendNotificationEmail(user.email, user.name, sender.title, sender.text.replace(/\n/g, "<br/>"), user.id))
    if (user.phone) result.sender.sms = await attempt("sms", () => sendNotificationSMS(user.phone, sender.text.split("\n\n")[0].replace(/\n/g, " "), user.id))
    result.sender.whatsapp = await sendWhatsApp(conn, { phone: user.phone || shipment.fromAddress.phone, name: user.name, body: sender.text, shipmentId: shipment.id, eventType: "BOOKING_CREATED" })
  }

  if (receiver && shipment.toAddress.phone) {
    result.receiver.sms = await attempt("receiver sms", () => sendNotificationSMS(shipment.toAddress.phone, receiver.text.replace(/\n/g, " "), null))
    result.receiver.whatsapp = await sendWhatsApp(conn, { phone: shipment.toAddress.phone, name: shipment.toAddress.fullName, body: receiver.text, shipmentId: shipment.id, eventType: "RECEIVER_NOTICE" })
  }

  await prisma.trackingEvent.create({
    data: {
      shipmentId: shipment.id, event: "BOOKING_MESSAGES_SENT", status: shipment.status,
      description: `Booking messages — sender: ${Object.entries(result.sender).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}; receiver: ${Object.entries(result.receiver).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    },
  }).catch(() => {})
  return result
}
