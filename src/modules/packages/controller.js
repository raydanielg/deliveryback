import prisma from "../../prisma/client.js"
import { scanPackageSchema } from "./validation.js"

const PACKAGE_STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER", "SGR_STATION_OFFICER", "CUSTOMER_SUPPORT"]

// Shared ownership check for CUSTOMER/DRIVER against the shipment a package belongs to —
// mirrors the pattern already used in shipments.getShipment. Returns true if allowed.
async function canAccessShipment(req, shipment) {
  if (!shipment) return false
  if (PACKAGE_STAFF.includes(req.user.role)) return true
  if (req.user.role === "CUSTOMER") return shipment.createdById === req.user.id
  if (req.user.role === "DRIVER") {
    const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } })
    return !!driver && shipment.driverId === driver.id
  }
  return false
}

// Forward progression only — DAMAGED/LOST are exception branches reachable from any
// non-terminal state, and DELIVERED is terminal. Mirrors the shipment-level status
// transition guard so a scan can't "un-deliver" or skip backward.
const SEQUENCE = ["CREATED", "SCANNED_AT_PICKUP", "SCANNED_AT_WAREHOUSE", "LOADED", "DEPARTED", "ARRIVED", "OUT_FOR_DELIVERY", "DELIVERED"]
const TERMINAL = ["DELIVERED", "DAMAGED", "LOST"]

function isValidTransition(from, to) {
  if (TERMINAL.includes(from)) return false
  if (to === "DAMAGED" || to === "LOST") return true
  const fromIdx = SEQUENCE.indexOf(from)
  const toIdx = SEQUENCE.indexOf(to)
  if (fromIdx === -1 || toIdx === -1) return false
  return toIdx > fromIdx
}

export async function getPackageByBarcode(req, res, next) {
  try {
    const { barcode } = req.params
    const pkg = await prisma.package.findUnique({
      where: { barcode },
      include: { shipment: { select: { id: true, trackingNumber: true, status: true, createdById: true, driverId: true } } },
    })
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" })

    if (!(await canAccessShipment(req, pkg.shipment))) {
      return res.status(404).json({ success: false, message: "Package not found" })
    }

    res.json({ success: true, data: pkg })
  } catch (err) { next(err) }
}

export async function listPackagesForShipment(req, res, next) {
  try {
    const { shipmentId } = req.params

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { createdById: true, driverId: true },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })
    if (!(await canAccessShipment(req, shipment))) {
      return res.status(404).json({ success: false, message: "Shipment not found" })
    }

    const packages = await prisma.package.findMany({ where: { shipmentId }, orderBy: { createdAt: "asc" } })
    const byStatus = packages.reduce((acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1
      return acc
    }, {})
    res.json({ success: true, data: packages, meta: { total: packages.length, byStatus } })
  } catch (err) { next(err) }
}

// Scans a single package (by its own barcode, independent of the shipment tracking
// number) forward through its lifecycle — used by warehouse/SGR/driver scan workflows
// that need to verify and record each physical package, not just the shipment as a whole.
export async function scanPackage(req, res, next) {
  try {
    const data = scanPackageSchema.parse(req.body)

    const pkg = await prisma.package.findUnique({
      where: { barcode: data.barcode },
      include: { shipment: { select: { status: true } } },
    })
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found for this barcode" })

    if (!isValidTransition(pkg.status, data.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot move package from ${pkg.status} to ${data.status}`,
      })
    }

    // A package-level scan doesn't necessarily change the shipment's own status (a
    // shipment can have several packages at different stages) — the tracking event
    // records the shipment's status as of this scan, unchanged, alongside the package event.
    const [updated] = await prisma.$transaction([
      prisma.package.update({ where: { id: pkg.id }, data: { status: data.status } }),
      prisma.trackingEvent.create({
        data: {
          shipmentId: pkg.shipmentId,
          event: `PACKAGE_${data.status}`,
          status: pkg.shipment.status,
          description: `Package ${pkg.barcode} scanned: ${data.status.replace(/_/g, " ").toLowerCase()}${data.notes ? ` — ${data.notes}` : ""}`,
          location: data.location,
          createdBy: req.user?.id,
        },
      }),
    ])

    res.json({ success: true, data: updated, message: "Package scanned" })
  } catch (err) { next(err) }
}

// Compares the shipment's expected package count (how many were declared at booking)
// against how many have actually been scanned at least once past CREATED — flags a
// discrepancy instead of letting a missing/extra package go unnoticed.
export async function getPackageDiscrepancy(req, res, next) {
  try {
    const { shipmentId } = req.params

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { createdById: true, driverId: true },
    })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })
    if (!(await canAccessShipment(req, shipment))) {
      return res.status(404).json({ success: false, message: "Shipment not found" })
    }

    const packages = await prisma.package.findMany({ where: { shipmentId } })
    const expected = packages.length
    const scanned = packages.filter((p) => p.status !== "CREATED").length
    const missing = packages.filter((p) => p.status === "CREATED")
    const damagedOrLost = packages.filter((p) => ["DAMAGED", "LOST"].includes(p.status))

    res.json({
      success: true,
      data: {
        expected,
        scanned,
        hasDiscrepancy: scanned !== expected || damagedOrLost.length > 0,
        missingPackages: missing.map((p) => ({ id: p.id, barcode: p.barcode })),
        damagedOrLostPackages: damagedOrLost.map((p) => ({ id: p.id, barcode: p.barcode, status: p.status })),
      },
    })
  } catch (err) { next(err) }
}
