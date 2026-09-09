import prisma from "../../prisma/client.js"
import crypto from "crypto"

// Every outbound event name the platform can emit. Extensible by design (Part Q) — adding
// a new one elsewhere in the app means adding a string here and calling emitEvent(), never
// writing a new one-off webhook call inside a controller.
export const EVENTS = {
  SHIPMENT_CREATED: "shipment.created",
  SHIPMENT_UPDATED: "shipment.updated",
  SHIPMENT_CANCELLED: "shipment.cancelled",
  PAYMENT_PENDING: "payment.pending",
  PAYMENT_SUCCESS: "payment.success",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_REFUNDED: "payment.refunded",
  DRIVER_ASSIGNED: "driver.assigned",
  DRIVER_REASSIGNED: "driver.reassigned",
  CARGO_RECEIVED: "cargo.received",
  CARGO_PICKED_UP: "cargo.picked_up",
  SHIPMENT_IN_TRANSIT: "shipment.in_transit",
  SHIPMENT_ARRIVED: "shipment.arrived",
  SHIPMENT_OUT_FOR_DELIVERY: "shipment.out_for_delivery",
  SHIPMENT_DELIVERED: "shipment.delivered",
  SHIPMENT_DELIVERY_FAILED: "shipment.delivery_failed",
  POD_CREATED: "pod.created",
  EXCEPTION_CREATED: "exception.created",
  EXCEPTION_RESOLVED: "exception.resolved",
  CUSTOMS_HOLD: "customs.hold",
  CUSTOMS_RELEASED: "customs.released",
  WAREHOUSE_RECEIVED: "warehouse.received",
  WAREHOUSE_MOVED: "warehouse.moved",
  WAREHOUSE_DISPATCHED: "warehouse.dispatched",
  SGR_LOADED: "sgr.loaded",
  SGR_DEPARTED: "sgr.departed",
  SGR_ARRIVED: "sgr.arrived",
  AIR_LOADED: "air.loaded",
  AIR_DEPARTED: "air.departed",
  AIR_ARRIVED: "air.arrived",
}

// Maps a ShipmentStatus value to the outbound event it should raise, where one applies.
// Used by updateShipmentStatus() so status transitions automatically fan out to partners
// without every call site needing to know the event name.
export const SHIPMENT_STATUS_EVENT_MAP = {
  PICKED_UP: EVENTS.CARGO_PICKED_UP,
  IN_TRANSIT: EVENTS.SHIPMENT_IN_TRANSIT,
  ARRIVED_DESTINATION: EVENTS.SHIPMENT_ARRIVED,
  OUT_FOR_DELIVERY: EVENTS.SHIPMENT_OUT_FOR_DELIVERY,
  DELIVERED: EVENTS.SHIPMENT_DELIVERED,
  DELIVERY_FAILED: EVENTS.SHIPMENT_DELIVERY_FAILED,
  CANCELLED: EVENTS.SHIPMENT_CANCELLED,
}

/**
 * Emits a domain event. Finds every ACTIVE partner subscribed to it (or a single partner,
 * when the event is inherently partner-scoped — e.g. their own external order) and queues
 * one WebhookDelivery row per partner. Delivery itself happens out-of-band via the
 * dispatcher poller — this function never makes an HTTP call, so a slow/offline partner can
 * never make the business operation that triggered the event fail or even slow down.
 */
export async function emitEvent(eventName, data, { partnerId } = {}) {
  const where = { status: "ACTIVE", subscribedEvents: { has: eventName } }
  if (partnerId) where.id = partnerId

  const partners = await prisma.partner.findMany({ where })
  if (partners.length === 0) return []

  const created = []
  for (const partner of partners) {
    if (!partner.webhookUrl) continue
    const eventId = `evt_${crypto.randomBytes(12).toString("hex")}`
    const delivery = await prisma.webhookDelivery.create({
      data: {
        eventId,
        partnerId: partner.id,
        event: eventName,
        endpoint: partner.webhookUrl,
        payload: {
          event: eventName,
          event_id: eventId,
          timestamp: new Date().toISOString(),
          partner_id: partner.id,
          data,
        },
        status: "PENDING",
      },
    })
    created.push(delivery)
  }
  return created
}
