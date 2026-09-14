import prisma from "../../prisma/client.js"

const WAREHOUSE_STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"]
const BROAD_STAFF = [...WAREHOUSE_STAFF, "SGR_STATION_OFFICER", "CUSTOMER_SUPPORT", "FINANCE"]

// Mirrors packages/controller.js's canAccessShipment — a customer/driver only ever sees
// their own shipment through a scan, everyone else on staff can see any of them.
async function canAccessShipment(req, shipment) {
  if (!shipment) return false
  if (BROAD_STAFF.includes(req.user.role)) return true
  if (req.user.role === "CUSTOMER") return shipment.createdById === req.user.id
  if (req.user.role === "DRIVER") {
    const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } })
    return !!driver && shipment.driverId === driver.id
  }
  return false
}

function shipmentActions(role, shipment, hasApproval) {
  if (!WAREHOUSE_STAFF.includes(role)) return []
  const actions = []
  if (shipment.status === "RECEIVED_AT_STATION") actions.push("VERIFY_WEIGH")
  if (["RECEIVED_AT_STATION", "VERIFIED_WEIGHED"].includes(shipment.status) && !shipment.shelfLocationId) actions.push("ASSIGN_SHELF")
  if (shipment.shelfLocationId && shipment.status !== "DELIVERED") {
    const freeRelease = shipment.deliveryOption === "COLLECT_AT_TAZARA_FREE" && shipment.paymentStatus === "PAID"
    actions.push(freeRelease || hasApproval ? "RELEASE" : "REQUEST_PAYMENT_APPROVAL")
  }
  return actions
}

function boxActions(role) {
  if (!WAREHOUSE_STAFF.includes(role)) return []
  return { PACKING: ["ADD_ITEM", "CLOSE_BOX"], PACKED: ["ASSIGN_TO_TRIP"], ARRIVED_TZ: ["ASSIGN_SHELF"] }
}

function tripActions(role) {
  if (!WAREHOUSE_STAFF.includes(role)) return []
  return { PLANNED: ["DEPART"], BOXES_ASSIGNED: ["DEPART"], DEPARTED: ["ARRIVE"] }
}

const PACKAGE_SEQUENCE = ["CREATED", "SCANNED_AT_PICKUP", "SCANNED_AT_WAREHOUSE", "LOADED", "DEPARTED", "ARRIVED", "OUT_FOR_DELIVERY", "DELIVERED"]
function packageActions(role, pkg) {
  if (!WAREHOUSE_STAFF.includes(role) && role !== "DRIVER") return []
  const idx = PACKAGE_SEQUENCE.indexOf(pkg.status)
  const actions = []
  if (idx >= 0 && idx < PACKAGE_SEQUENCE.length - 1) actions.push(`ADVANCE:${PACKAGE_SEQUENCE[idx + 1]}`)
  if (!["DELIVERED", "DAMAGED", "LOST"].includes(pkg.status)) actions.push("MARK:DAMAGED", "MARK:LOST")
  return actions
}

// Single entry point for every scanner in the ops app (and the web) — resolves a scanned
// code against box -> trip -> package -> shipment (in that order) and returns
// {type, data, availableActions}, with availableActions computed here from the caller's
// role + the record's current status. This is what lets the two previously-divergent
// warehouse/package scan screens converge on one flow instead of hardcoding status
// vocabularies client-side.
export async function resolveScan(req, res, next) {
  try {
    const { code } = req.params

    const box = await prisma.consolidationBox.findFirst({
      where: { OR: [{ qrPayload: code }, { boxNumber: code }] },
      include: {
        items: { include: { shipment: { select: { id: true, trackingNumber: true, description: true, createdById: true } } } },
        tripManifest: true, currentShelfLocation: true, originStation: true, currentStation: true,
      },
    })
    if (box) {
      if (!WAREHOUSE_STAFF.includes(req.user.role)) return res.status(404).json({ success: false, message: "Not found" })
      const actionsByStatus = boxActions(req.user.role)
      return res.json({ success: true, data: { type: "BOX", data: box, availableActions: actionsByStatus[box.status] || [] } })
    }

    const trip = await prisma.tripManifest.findFirst({
      where: { OR: [{ qrPayload: code }, { tripNo: code }] },
      include: { boxes: true },
    })
    if (trip) {
      if (!WAREHOUSE_STAFF.includes(req.user.role)) return res.status(404).json({ success: false, message: "Not found" })
      const actionsByStatus = tripActions(req.user.role)
      return res.json({ success: true, data: { type: "TRIP", data: trip, availableActions: actionsByStatus[trip.status] || [] } })
    }

    const pkg = await prisma.package.findUnique({
      where: { barcode: code },
      include: { shipment: { select: { id: true, trackingNumber: true, status: true, createdById: true, driverId: true } } },
    })
    if (pkg) {
      if (!(await canAccessShipment(req, pkg.shipment))) return res.status(404).json({ success: false, message: "Not found" })
      return res.json({ success: true, data: { type: "PACKAGE", data: pkg, availableActions: packageActions(req.user.role, pkg) } })
    }

    const shipment = await prisma.shipment.findFirst({
      where: { OR: [{ trackingNumber: code }, { qrPayload: code }] },
      include: {
        packages: true, shelfLocation: true, deliveryZone: true, fromAddress: true, toAddress: true,
        order: { select: { orderNumber: true, paymentStatus: true } },
      },
    })
    if (shipment) {
      if (!(await canAccessShipment(req, shipment))) return res.status(404).json({ success: false, message: "Not found" })

      let hasApproval = false
      if (WAREHOUSE_STAFF.includes(req.user.role)) {
        const approval = await prisma.paymentApproval.findFirst({
          where: { shipmentId: shipment.id, approvalStatus: "APPROVED" },
          orderBy: { createdAt: "desc" },
        })
        hasApproval = !!approval
      }
      return res.json({ success: true, data: { type: "SHIPMENT", data: shipment, availableActions: shipmentActions(req.user.role, shipment, hasApproval) } })
    }

    return res.status(404).json({ success: false, message: "No box, trip, package, or shipment found for this code" })
  } catch (err) { next(err) }
}
