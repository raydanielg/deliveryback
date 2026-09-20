import prisma from "../prisma/client.js"
import { getOrCreateSettings } from "../modules/delivery-config/controller.js"

// XERIN spec §6/§7.7 — a parcel sitting ON_SHELF longer than oldStockDays (default 30,
// pending management decision) is flagged OLD_STOCK automatically. Runs nightly via
// startOldStockJob() and on demand via POST /api/v1/delivery-config/jobs/flag-old-stock.

export async function flagOldStock() {
  const settings = await getOrCreateSettings()
  const cutoff = new Date(Date.now() - settings.oldStockDays * 24 * 60 * 60 * 1000)

  const stale = await prisma.shipment.findMany({
    where: { status: "ON_SHELF", storageStartAt: { lt: cutoff } },
    select: { id: true, trackingNumber: true, storageStartAt: true },
  })

  if (stale.length === 0) return { flagged: 0, cutoff, oldStockDays: settings.oldStockDays }

  await prisma.$transaction(async (tx) => {
    await tx.shipment.updateMany({
      where: { id: { in: stale.map((s) => s.id) } },
      data: { status: "OLD_STOCK", lastMovementAt: new Date() },
    })
    await tx.trackingEvent.createMany({
      data: stale.map((s) => ({
        shipmentId: s.id,
        event: "OLD_STOCK",
        status: "OLD_STOCK",
        description: `Auto-flagged old stock — on shelf since ${s.storageStartAt?.toISOString().slice(0, 10)} (> ${settings.oldStockDays} days)`,
      })),
    })
  })

  return { flagged: stale.length, trackingNumbers: stale.map((s) => s.trackingNumber), cutoff, oldStockDays: settings.oldStockDays }
}

const DAY_MS = 24 * 60 * 60 * 1000

export function startOldStockJob() {
  // First pass shortly after boot so a long-down server catches up, then daily.
  const timer = setTimeout(() => {
    flagOldStock().then(
      (r) => console.log(`[OldStockJob] Flagged ${r.flagged} shipment(s) as OLD_STOCK`),
      (err) => console.error("[OldStockJob] Error:", err.message)
    )
    setInterval(() => {
      flagOldStock().then(
        (r) => r.flagged && console.log(`[OldStockJob] Flagged ${r.flagged} shipment(s) as OLD_STOCK`),
        (err) => console.error("[OldStockJob] Error:", err.message)
      )
    }, DAY_MS).unref()
  }, 60 * 1000)
  timer.unref()
  console.log("[OldStockJob] Daily old-stock flagging scheduled")
}
