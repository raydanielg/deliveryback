import prisma from "../../prisma/client.js"
import { zoneSchema, storageSettingsSchema } from "./validation.js"

// Exact customer choices from the operational Config_Lists sheet. Enum identifiers can't
// hold spaces/dashes, so the human-readable label lives here rather than in the enum.
export const DELIVERY_OPTIONS = [
  { value: "COLLECT_AT_TAZARA_FREE", label: "Collect at Tazara - Free", requiresZone: false },
  { value: "COLLECT_AT_OTHER_POINT_CHARGED", label: "Collect at Uhuru Heights - Charges Apply", requiresZone: true },
  { value: "HOME_OFFICE_DELIVERY_CHARGED", label: "Home/Office Delivery - Charges Apply", requiresZone: true },
]

export async function getOrCreateSettings() {
  let settings = await prisma.consolidationSettings.findFirst()
  if (!settings) settings = await prisma.consolidationSettings.create({ data: {} })
  return settings
}

function daysBetween(a, b) {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)))
}

// Shared by payment-approvals (request) and the warehouse release gate, so the charge
// shown to Finance for approval is exactly the charge the release check enforces.
export async function computeCharges(shipment) {
  const settings = await getOrCreateSettings()
  const chargeableDays = shipment.storageStartAt
    ? Math.max(0, daysBetween(shipment.storageStartAt, new Date()) - settings.freeStorageDays)
    : 0
  const storageCharge = chargeableDays * Number(settings.storageRatePerDayTzs)
  const deliveryFee = shipment.deliveryOption && shipment.deliveryOption !== "COLLECT_AT_TAZARA_FREE"
    ? Number(shipment.deliveryZone?.feeAmount || 0)
    : 0
  return { chargeableDays, storageCharge, deliveryFee, totalCharges: storageCharge + deliveryFee }
}

export async function getDeliveryOptions(req, res, next) {
  try {
    res.json({ success: true, data: DELIVERY_OPTIONS })
  } catch (err) { next(err) }
}

export async function listZones(req, res, next) {
  try {
    const zones = await prisma.deliveryZone.findMany({ orderBy: { name: "asc" } })
    res.json({ success: true, data: zones })
  } catch (err) { next(err) }
}

export async function createZone(req, res, next) {
  try {
    const data = zoneSchema.parse(req.body)
    const zone = await prisma.deliveryZone.create({ data })
    res.status(201).json({ success: true, data: zone, message: "Delivery zone created" })
  } catch (err) { next(err) }
}

export async function updateZone(req, res, next) {
  try {
    const data = zoneSchema.partial().parse(req.body)
    const zone = await prisma.deliveryZone.update({ where: { id: req.params.id }, data })
    res.json({ success: true, data: zone, message: "Delivery zone updated" })
  } catch (err) { next(err) }
}

export async function deleteZone(req, res, next) {
  try {
    await prisma.deliveryZone.delete({ where: { id: req.params.id } })
    res.json({ success: true, message: "Delivery zone deleted" })
  } catch (err) { next(err) }
}

export async function getStorageSettings(req, res, next) {
  try {
    const settings = await getOrCreateSettings()
    res.json({ success: true, data: settings })
  } catch (err) { next(err) }
}

export async function updateStorageSettings(req, res, next) {
  try {
    const data = storageSettingsSchema.parse(req.body)
    const settings = await getOrCreateSettings()
    const updated = await prisma.consolidationSettings.update({
      where: { id: settings.id }, data: { ...data, updatedById: req.user.id },
    })
    res.json({ success: true, data: updated, message: "Storage settings updated" })
  } catch (err) { next(err) }
}
