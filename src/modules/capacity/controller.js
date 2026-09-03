import prisma from "../../prisma/client.js"
import { createNotification } from "../notifications/controller.js"

export async function getCapacityOverview(req, res, next) {
  try {
    const manifests = await prisma.manifest.findMany({
      where: {
        status: { in: ["PENDING", "LOADING", "DEPARTED", "IN_TRANSIT"] },
        reservedBlockSpaceKg: { not: null },
      },
      include: {
        shipments: { select: { id: true, chargeableWeightKg: true, trackingNumber: true } },
        station: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
    })

    const capacityData = manifests.map((m) => {
      const usedWeight = m.shipments.reduce(
        (sum, s) => sum + Number(s.chargeableWeightKg || 0),
        0
      )
      const reserved = Number(m.reservedBlockSpaceKg || 0)
      const utilization = reserved > 0 ? (usedWeight / reserved) * 100 : 0
      return {
        manifestId: m.id,
        manifestNumber: m.manifestNumber,
        batchNo: m.batchNo,
        originStation: m.originStation,
        destinationStation: m.destinationStation,
        station: m.station,
        reservedBlockSpaceKg: reserved,
        usedWeightKg: usedWeight,
        remainingKg: Math.max(0, reserved - usedWeight),
        utilizationPercent: Math.round(utilization * 100) / 100,
        shipmentCount: m.shipments.length,
        status: m.status,
        isOverCapacity: usedWeight > reserved,
        isNearCapacity: utilization >= 80 && utilization < 100,
      }
    })

    const totalReserved = capacityData.reduce((s, c) => s + c.reservedBlockSpaceKg, 0)
    const totalUsed = capacityData.reduce((s, c) => s + c.usedWeightKg, 0)
    const overCapacityCount = capacityData.filter((c) => c.isOverCapacity).length
    const nearCapacityCount = capacityData.filter((c) => c.isNearCapacity).length

    res.json({
      success: true,
      data: {
        manifests: capacityData,
        summary: {
          totalManifests: capacityData.length,
          totalReservedKg: totalReserved,
          totalUsedKg: totalUsed,
          totalRemainingKg: Math.max(0, totalReserved - totalUsed),
          overallUtilization: totalReserved > 0 ? Math.round((totalUsed / totalReserved) * 10000) / 100 : 0,
          overCapacityCount,
          nearCapacityCount,
        },
      },
    })
  } catch (err) { next(err) }
}

export async function getManifestCapacity(req, res, next) {
  try {
    const { id } = req.params
    const manifest = await prisma.manifest.findUnique({
      where: { id },
      include: {
        shipments: {
          select: {
            id: true, trackingNumber: true, chargeableWeightKg: true,
            status: true, order: { select: { senderName: true, receiverName: true } },
          },
        },
        station: { select: { id: true, name: true, code: true, capacityKg: true } },
      },
    })

    if (!manifest) return res.status(404).json({ success: false, message: "Manifest not found" })

    const usedWeight = manifest.shipments.reduce(
      (sum, s) => sum + Number(s.chargeableWeightKg || 0),
      0
    )
    const reserved = Number(manifest.reservedBlockSpaceKg || 0)
    const utilization = reserved > 0 ? (usedWeight / reserved) * 100 : 0

    res.json({
      success: true,
      data: {
        manifestId: manifest.id,
        manifestNumber: manifest.manifestNumber,
        batchNo: manifest.batchNo,
        reservedBlockSpaceKg: reserved,
        usedWeightKg: usedWeight,
        remainingKg: Math.max(0, reserved - usedWeight),
        utilizationPercent: Math.round(utilization * 100) / 100,
        shipmentCount: manifest.shipments.length,
        isOverCapacity: usedWeight > reserved,
        isNearCapacity: utilization >= 80 && utilization < 100,
        shipments: manifest.shipments,
        station: manifest.station,
      },
    })
  } catch (err) { next(err) }
}

export async function checkCapacityAlerts(req, res, next) {
  try {
    const manifests = await prisma.manifest.findMany({
      where: {
        status: { in: ["PENDING", "LOADING"] },
        reservedBlockSpaceKg: { not: null },
      },
      include: {
        shipments: { select: { chargeableWeightKg: true } },
        createdBy: { select: { id: true, name: true } },
      },
    })

    const alerts = []
    for (const m of manifests) {
      const usedWeight = m.shipments.reduce(
        (sum, s) => sum + Number(s.chargeableWeightKg || 0),
        0
      )
      const reserved = Number(m.reservedBlockSpaceKg || 0)
      const utilization = reserved > 0 ? (usedWeight / reserved) * 100 : 0

      if (utilization >= 80) {
        const alert = {
          manifestId: m.id,
          manifestNumber: m.manifestNumber,
          batchNo: m.batchNo,
          reservedBlockSpaceKg: reserved,
          usedWeightKg: usedWeight,
          utilizationPercent: Math.round(utilization * 100) / 100,
          severity: utilization >= 100 ? "CRITICAL" : "WARNING",
          message: utilization >= 100
            ? `Manifest ${m.manifestNumber} has exceeded reserved block space capacity`
            : `Manifest ${m.manifestNumber} is at ${Math.round(utilization)}% capacity`,
        }
        alerts.push(alert)

        await createNotification(
          m.createdById,
          "CAPACITY_ALERT",
          alert.severity === "CRITICAL" ? "Capacity Exceeded" : "Capacity Warning",
          alert.message,
          { manifestId: m.id, ...alert }
        )
      }
    }

    res.json({
      success: true,
      data: {
        alerts,
        totalAlerts: alerts.length,
        criticalCount: alerts.filter((a) => a.severity === "CRITICAL").length,
        warningCount: alerts.filter((a) => a.severity === "WARNING").length,
      },
    })
  } catch (err) { next(err) }
}

export async function getStationCapacity(req, res, next) {
  try {
    const stations = await prisma.station.findMany({
      where: { capacityKg: { not: null } },
      include: {
        inventory: {
          where: { status: "RECEIVED" },
          include: { shipment: { select: { chargeableWeightKg: true } } },
        },
      },
    })

    const stationCapacity = stations.map((s) => {
      const usedWeight = s.inventory.reduce(
        (sum, inv) => sum + Number(inv.shipment?.chargeableWeightKg || 0),
        0
      )
      const capacity = Number(s.capacityKg || 0)
      const utilization = capacity > 0 ? (usedWeight / capacity) * 100 : 0
      return {
        stationId: s.id,
        stationName: s.name,
        stationCode: s.code,
        capacityKg: capacity,
        usedWeightKg: usedWeight,
        remainingKg: Math.max(0, capacity - usedWeight),
        utilizationPercent: Math.round(utilization * 100) / 100,
        inventoryCount: s.inventory.length,
        isOverCapacity: usedWeight > capacity,
        isNearCapacity: utilization >= 80 && utilization < 100,
      }
    })

    res.json({ success: true, data: stationCapacity })
  } catch (err) { next(err) }
}
