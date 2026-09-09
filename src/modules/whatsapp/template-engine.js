import prisma from "../../prisma/client.js"

// ============================================================
// WHATSAPP TEMPLATE ENGINE
// ============================================================
// Reusable templates with {{variable}} interpolation.
// Variables come from real XERIN database data.
// ============================================================

// ---------------------------------------------------------
// RENDER TEMPLATE — replace {{variables}} with real values
// ---------------------------------------------------------

export function renderTemplate(templateBody, variables = {}) {
  return templateBody.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key]
    if (value === undefined || value === null) {
      return ""
    }
    return String(value)
  })
}

// ---------------------------------------------------------
// GET TEMPLATE BY EVENT TYPE
// ---------------------------------------------------------

export async function getTemplateByEvent(eventType) {
  const template = await prisma.whatsAppTemplate.findFirst({
    where: { eventType, isActive: true },
  })
  return template
}

// ---------------------------------------------------------
// GET TEMPLATE BY NAME
// ---------------------------------------------------------

export async function getTemplateByName(name) {
  return prisma.whatsAppTemplate.findUnique({ where: { name } })
}

// ---------------------------------------------------------
// EXTRACT VARIABLES FROM TEMPLATE BODY
// ---------------------------------------------------------

export function extractVariables(templateBody) {
  const matches = templateBody.matchAll(/\{\{(\w+)\}\}/g)
  const vars = new Set()
  for (const match of matches) {
    vars.add(match[1])
  }
  return Array.from(vars)
}

// ---------------------------------------------------------
// CREATE TEMPLATE
// ---------------------------------------------------------

export async function createTemplate({ name, eventType, body, smsBody, category, language, createdBy }) {
  const variables = extractVariables(body)
  return prisma.whatsAppTemplate.create({
    data: {
      name,
      eventType: eventType || null,
      body,
      smsBody: smsBody || null,
      category: category || "TRANSACTIONAL",
      language: language || "en",
      variables,
      isActive: true,
      createdBy,
    },
  })
}

// ---------------------------------------------------------
// UPDATE TEMPLATE
// ---------------------------------------------------------

export async function updateTemplate(id, { name, eventType, body, smsBody, category, isActive }) {
  const updateData = {}
  if (name !== undefined) updateData.name = name
  if (eventType !== undefined) updateData.eventType = eventType
  if (body !== undefined) {
    updateData.body = body
    updateData.variables = extractVariables(body)
  }
  if (smsBody !== undefined) updateData.smsBody = smsBody
  if (category !== undefined) updateData.category = category
  if (isActive !== undefined) updateData.isActive = isActive

  return prisma.whatsAppTemplate.update({
    where: { id },
    data: updateData,
  })
}

// ---------------------------------------------------------
// LIST TEMPLATES
// ---------------------------------------------------------

export async function listTemplates({ category, eventType, active } = {}) {
  const where = {}
  if (category) where.category = category
  if (eventType) where.eventType = eventType
  if (active !== undefined) where.isActive = active

  return prisma.whatsAppTemplate.findMany({
    where,
    orderBy: { createdAt: "desc" },
  })
}

// ---------------------------------------------------------
// SEED DEFAULT TEMPLATES (called on first startup)
// ---------------------------------------------------------

export async function seedDefaultTemplates() {
  const defaults = [
    {
      name: "otp_verification",
      eventType: "OTP",
      category: "OTP",
      body: "XERIN Express: Your verification code is {{otp}}. It expires in 10 minutes. Do not share this code with anyone.",
      smsBody: "XERIN Express: Your verification code is {{otp}}. Expires in 10 min.",
      variables: ["otp"],
    },
    {
      name: "booking_confirmation",
      eventType: "BOOKING_CREATED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour XERIN shipment {{tracking_number}} has been booked successfully.\n\nTrack your shipment: {{tracking_url}}\n\nThank you for choosing XERIN Express.",
      smsBody: "XERIN: Shipment {{tracking_number}} booked. Track: {{tracking_url}}",
      variables: ["customer_name", "tracking_number", "tracking_url"],
    },
    {
      name: "payment_success",
      eventType: "PAYMENT_SUCCESS",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nWe've received your payment of {{amount}} {{currency}} for shipment {{tracking_number}}.\nPayment reference: {{payment_reference}}\n\nThank you for choosing XERIN Express.",
      smsBody: "XERIN: Payment of {{amount}} {{currency}} received for {{tracking_number}}. Ref: {{payment_reference}}",
      variables: ["customer_name", "tracking_number", "amount", "currency", "payment_reference"],
    },
    {
      name: "payment_failed",
      eventType: "PAYMENT_FAILED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour payment for shipment {{tracking_number}} failed. Please retry payment or contact support.\n\nXERIN Express",
      smsBody: "XERIN: Payment for {{tracking_number}} failed. Please retry.",
      variables: ["customer_name", "tracking_number"],
    },
    {
      name: "driver_assigned",
      eventType: "DRIVER_ASSIGNED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nA driver has been assigned to your shipment {{tracking_number}}.\nDriver: {{driver_name}}\nVehicle: {{vehicle}}\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN: Driver {{driver_name}} assigned to {{tracking_number}}. Track: {{tracking_url}}",
      variables: ["customer_name", "tracking_number", "driver_name", "vehicle", "tracking_url"],
    },
    {
      name: "driver_accepted",
      eventType: "DRIVER_ACCEPTED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour driver has accepted the delivery for shipment {{tracking_number}} and is on the way.\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN: Driver accepted delivery for {{tracking_number}}. Track: {{tracking_url}}",
      variables: ["customer_name", "tracking_number", "tracking_url"],
    },
    {
      name: "driver_reassigned",
      eventType: "DRIVER_REASSIGNED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour shipment {{tracking_number}} has been reassigned to a new driver.\nDriver: {{driver_name}}\nVehicle: {{vehicle}}\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN: {{tracking_number}} reassigned to {{driver_name}}. Track: {{tracking_url}}",
      variables: ["customer_name", "tracking_number", "driver_name", "vehicle", "tracking_url"],
    },
    {
      name: "cargo_picked_up",
      eventType: "CARGO_PICKED_UP",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour parcel {{tracking_number}} has been picked up and is on its way.\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN: Parcel {{tracking_number}} picked up. Track: {{tracking_url}}",
      variables: ["customer_name", "tracking_number", "tracking_url"],
    },
    {
      name: "shipment_in_transit",
      eventType: "SHIPMENT_IN_TRANSIT",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour parcel {{tracking_number}} is now in transit from {{origin}} to {{destination}}.\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN: {{tracking_number}} in transit {{origin}} → {{destination}}. Track: {{tracking_url}}",
      variables: ["customer_name", "tracking_number", "origin", "destination", "tracking_url"],
    },
    {
      name: "out_for_delivery",
      eventType: "OUT_FOR_DELIVERY",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour parcel {{tracking_number}} is out for delivery! Please be ready to receive it.\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN: {{tracking_number}} out for delivery! Be ready to receive.",
      variables: ["customer_name", "tracking_number", "tracking_url"],
    },
    {
      name: "delivered",
      eventType: "DELIVERED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour parcel {{tracking_number}} has been delivered successfully.\n\nProof of delivery: {{pod_url}}\n\nThank you for choosing XERIN Express!",
      smsBody: "XERIN: {{tracking_number}} delivered. POD: {{pod_url}}",
      variables: ["customer_name", "tracking_number", "pod_url"],
    },
    {
      name: "pod_created",
      eventType: "POD_CREATED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nProof of delivery for shipment {{tracking_number}} is now available.\nView POD: {{pod_url}}\n\nXERIN Express",
      smsBody: "XERIN: POD for {{tracking_number}} available: {{pod_url}}",
      variables: ["customer_name", "tracking_number", "pod_url"],
    },
    {
      name: "exception_created",
      eventType: "EXCEPTION_CREATED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nAn exception has been raised for your shipment {{tracking_number}}.\nDetails: {{exception_type}}\nOur team is handling this. Contact support if needed.\n\nXERIN Express",
      smsBody: "XERIN: Exception for {{tracking_number}}: {{exception_type}}. Team handling.",
      variables: ["customer_name", "tracking_number", "exception_type"],
    },
    // SGR Templates
    {
      name: "sgr_cargo_received",
      eventType: "SGR_CARGO_RECEIVED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour SGR parcel {{tracking_number}} has been received at {{station_name}} station.\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN SGR: Parcel {{tracking_number}} received at {{station_name}}. Track: {{tracking_url}}",
      variables: ["customer_name", "tracking_number", "station_name", "tracking_url"],
    },
    {
      name: "sgr_train_assigned",
      eventType: "SGR_TRAIN_ASSIGNED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour SGR parcel {{tracking_number}} has been assigned to train {{train_number}}.\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN SGR: {{tracking_number}} on train {{train_number}}. Track: {{tracking_url}}",
      variables: ["customer_name", "tracking_number", "train_number", "tracking_url"],
    },
    {
      name: "sgr_loaded",
      eventType: "SGR_LOADED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour SGR parcel {{tracking_number}} has been loaded onto train {{train_number}}.\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN SGR: {{tracking_number}} loaded on train {{train_number}}.",
      variables: ["customer_name", "tracking_number", "train_number", "tracking_url"],
    },
    {
      name: "sgr_departed",
      eventType: "SGR_DEPARTED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nTrain {{train_number}} has departed with your SGR parcel {{tracking_number}}.\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN SGR: Train {{train_number}} departed with {{tracking_number}}.",
      variables: ["customer_name", "tracking_number", "train_number", "tracking_url"],
    },
    {
      name: "sgr_arrived",
      eventType: "SGR_ARRIVED",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nTrain {{train_number}} has arrived. Your SGR parcel {{tracking_number}} is at {{station_name}} station.\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN SGR: {{tracking_number}} arrived at {{station_name}}. Track: {{tracking_url}}",
      variables: ["customer_name", "tracking_number", "train_number", "station_name", "tracking_url"],
    },
    {
      name: "sgr_ready_for_collection",
      eventType: "READY_FOR_COLLECTION",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour SGR parcel {{tracking_number}} is ready for collection at {{station_name}} station.\n\nPlease bring your ID and tracking number.\n\nXERIN Express",
      smsBody: "XERIN SGR: {{tracking_number}} ready for collection at {{station_name}}.",
      variables: ["customer_name", "tracking_number", "station_name"],
    },
    {
      name: "sgr_last_mile",
      eventType: "SGR_LAST_MILE",
      category: "TRANSACTIONAL",
      body: "Hello {{customer_name}},\n\nYour SGR parcel {{tracking_number}} has been assigned to a driver for last-mile delivery.\nDriver: {{driver_name}}\n\nTrack: {{tracking_url}}",
      smsBody: "XERIN SGR: {{tracking_number}} out for last-mile delivery by {{driver_name}}.",
      variables: ["customer_name", "tracking_number", "driver_name", "tracking_url"],
    },
    {
      name: "driver_opportunity",
      eventType: "DRIVER_OPPORTUNITY",
      category: "TRANSACTIONAL",
      body: "Hello {{driver_name}},\n\nA new delivery opportunity is available.\nRoute: {{origin}} → {{destination}}\nDistance: {{distance}}\nPayment: {{payment}}\n\nAccept in the driver app.",
      smsBody: "XERIN: New delivery opportunity {{origin}} → {{destination}}. Check app.",
      variables: ["driver_name", "origin", "destination", "distance", "payment"],
    },
  ]

  for (const tmpl of defaults) {
    const exists = await prisma.whatsAppTemplate.findUnique({ where: { name: tmpl.name } })
    if (!exists) {
      await prisma.whatsAppTemplate.create({
        data: {
          name: tmpl.name,
          eventType: tmpl.eventType,
          category: tmpl.category,
          body: tmpl.body,
          smsBody: tmpl.smsBody,
          variables: tmpl.variables,
          isActive: true,
        },
      })
      console.log(`[WhatsApp] Seeded template: ${tmpl.name}`)
    }
  }
}
