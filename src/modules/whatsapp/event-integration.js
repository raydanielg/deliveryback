import { triggerEventNotification } from "./messaging-service.js"
import { emitEvent, EVENTS } from "../integrations/event-bus.js"

// ============================================================
// WHATSAPP EVENT INTEGRATION
// ============================================================
// Connects XERIN events to WhatsApp notifications.
// Messaging failures NEVER corrupt core logistics operations.
// ============================================================

// ---------------------------------------------------------
// EVENT → WHATSAPP MAPPING
// ---------------------------------------------------------

const EVENT_WHATSAPP_MAP = {
  // Shipment events
  [EVENTS.SHIPMENT_CREATED]: "BOOKING_CREATED",
  [EVENTS.CARGO_PICKED_UP]: "CARGO_PICKED_UP",
  [EVENTS.SHIPMENT_IN_TRANSIT]: "SHIPMENT_IN_TRANSIT",
  [EVENTS.SHIPMENT_ARRIVED]: "ARRIVED_DESTINATION",
  [EVENTS.SHIPMENT_OUT_FOR_DELIVERY]: "OUT_FOR_DELIVERY",
  [EVENTS.SHIPMENT_DELIVERED]: "DELIVERED",
  [EVENTS.SHIPMENT_DELIVERY_FAILED]: "DELIVERY_FAILED",
  [EVENTS.POD_CREATED]: "POD_CREATED",

  // Driver events
  [EVENTS.DRIVER_ASSIGNED]: "DRIVER_ASSIGNED",
  [EVENTS.DRIVER_REASSIGNED]: "DRIVER_REASSIGNED",

  // Payment events
  [EVENTS.PAYMENT_SUCCESS]: "PAYMENT_SUCCESS",
  [EVENTS.PAYMENT_FAILED]: "PAYMENT_FAILED",

  // Exception events
  [EVENTS.EXCEPTION_CREATED]: "EXCEPTION_CREATED",

  // SGR events
  [EVENTS.SGR_LOADED]: "SGR_LOADED",
  [EVENTS.SGR_DEPARTED]: "SGR_DEPARTED",
  [EVENTS.SGR_ARRIVED]: "SGR_ARRIVED",

  // Warehouse events
  [EVENTS.WAREHOUSE_RECEIVED]: "WAREHOUSE_RECEIVED",
}

// ---------------------------------------------------------
// INITIALIZE EVENT LISTENERS
// ---------------------------------------------------------

export function initWhatsAppEventIntegration() {
  for (const [event, whatsappEventType] of Object.entries(EVENT_WHATSAPP_MAP)) {
    // Listen to each event and trigger WhatsApp notification
    // We use a lightweight approach: the event bus emitEvent function
    // is called from controllers, and we hook into it here.

    // Since emitEvent doesn't have a listener model, we integrate
    // by wrapping the triggerStatusNotification and triggerPaymentNotification
    // functions that are already called from the shipment/SGR controllers.
  }

  console.log("[WhatsApp] Event integration initialized")
}

// ---------------------------------------------------------
// TRIGGER WHATSAPP FROM SHIPMENT STATUS CHANGE
// ---------------------------------------------------------

export async function triggerWhatsAppFromShipmentStatus(shipmentId, newStatus, extraVariables = {}) {
  try {
    const eventType = _mapShipmentStatusToWhatsAppEvent(newStatus)
    if (!eventType) return null

    return await triggerEventNotification(eventType, shipmentId, extraVariables)
  } catch (err) {
    // NEVER let WhatsApp failure corrupt shipment operations
    console.error("[WhatsApp] Event trigger failed (non-blocking):", err.message)
    return null
  }
}

// ---------------------------------------------------------
// TRIGGER WHATSAPP FROM SGR EVENT
// ---------------------------------------------------------

export async function triggerWhatsAppFromSGREvent(shipmentId, eventType, extraVariables = {}) {
  try {
    return await triggerEventNotification(eventType, shipmentId, extraVariables)
  } catch (err) {
    console.error("[WhatsApp] SGR event trigger failed (non-blocking):", err.message)
    return null
  }
}

// ---------------------------------------------------------
// TRIGGER WHATSAPP FROM DRIVER EVENT
// ---------------------------------------------------------

export async function triggerWhatsAppFromDriverEvent(shipmentId, eventType, driverName, extraVariables = {}) {
  try {
    return await triggerEventNotification(eventType, shipmentId, {
      driver_name: driverName,
      ...extraVariables,
    })
  } catch (err) {
    console.error("[WhatsApp] Driver event trigger failed (non-blocking):", err.message)
    return null
  }
}

// ---------------------------------------------------------
// TRIGGER WHATSAPP FROM PAYMENT EVENT
// ---------------------------------------------------------

export async function triggerWhatsAppFromPaymentEvent(shipmentId, amount, currency, paymentReference, success = true) {
  try {
    const eventType = success ? "PAYMENT_SUCCESS" : "PAYMENT_FAILED"
    return await triggerEventNotification(eventType, shipmentId, {
      amount: String(amount),
      currency: currency || "TZS",
      payment_reference: paymentReference || "",
    })
  } catch (err) {
    console.error("[WhatsApp] Payment event trigger failed (non-blocking):", err.message)
    return null
  }
}

// ---------------------------------------------------------
// MAP SHIPMENT STATUS TO WHATSAPP EVENT TYPE
// ---------------------------------------------------------

function _mapShipmentStatusToWhatsAppEvent(status) {
  const map = {
    BOOKED: "BOOKING_CREATED",
    PICKED_UP: "CARGO_PICKED_UP",
    IN_TRANSIT: "SHIPMENT_IN_TRANSIT",
    ARRIVED_DESTINATION: "ARRIVED_DESTINATION",
    OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
    DELIVERED: "DELIVERED",
    DELIVERY_FAILED: "DELIVERY_FAILED",
    CARGO_RECEIVED: "SGR_CARGO_RECEIVED",
    TRAIN_ASSIGNED: "SGR_TRAIN_ASSIGNED",
    LOADED: "SGR_LOADED",
    TRAIN_DEPARTED: "SGR_DEPARTED",
    TRAIN_ARRIVED: "SGR_ARRIVED",
    READY_FOR_COLLECTION: "READY_FOR_COLLECTION",
    LAST_MILE_ASSIGNED: "SGR_LAST_MILE",
  }
  return map[status] || null
}
