import prisma from "../prisma/client.js"

// Branch scoping — the one place that decides what a branch manager or an agent may see.
//
//   BRANCH_MANAGER  shipments that start or end at their own branch
//   AGENT           only shipments they have been given a task on
//   everyone else   unscoped here (their own role rules apply)
//
// A branch manager with no branch assigned sees nothing rather than everything: failing open on a
// misconfigured account would be the worst way to get this wrong.
export const BRANCH_ROLES = ["BRANCH_MANAGER", "AGENT"]
export const AGENT_KINDS = ["CLEARING", "FORWARDING", "RECEIVING"]

export function isBranchRole(role) {
  return BRANCH_ROLES.includes(role)
}

// Prisma `where` fragment restricting shipments for this user, or null when no branch rule applies.
export async function shipmentScope(user) {
  if (user.role === "BRANCH_MANAGER") {
    const branchId = user.branchId ?? (await prisma.user.findUnique({ where: { id: user.id }, select: { branchId: true } }))?.branchId
    if (!branchId) return { id: "__no_branch_assigned__" }
    return { OR: [{ originBranchId: branchId }, { destinationBranchId: branchId }] }
  }
  if (user.role === "AGENT") {
    return { agentTasks: { some: { assignedToId: user.id, status: { not: "CANCELLED" } } } }
  }
  return null
}

// True when this user may see/act on this shipment (id lookup, so it can guard single-record routes).
export async function canAccessShipment(user, shipmentId) {
  const scope = await shipmentScope(user)
  if (!scope) return true
  const hit = await prisma.shipment.findFirst({ where: { AND: [{ id: shipmentId }, scope] }, select: { id: true } })
  return !!hit
}

const FULL_VIEW_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "FINANCE", "WAREHOUSE_MANAGER"]

// Orders (and, through them, payments) a user may see. null = everything (the four staff roles that
// run the business). Everyone else is narrowed to their own or to the shipments they work on — the
// old rule "customers are filtered, everyone else sees all" leaked every customer's orders to
// drivers, agents and branch managers.
export async function orderScope(user) {
  if (user.role === "CUSTOMER") return { createdById: user.id }
  if (FULL_VIEW_ROLES.includes(user.role)) return null
  if (user.role === "DRIVER") {
    const driver = await prisma.driver.findUnique({ where: { userId: user.id }, select: { id: true } })
    return { shipments: { some: { driverId: driver?.id ?? "__no_driver_profile__" } } }
  }
  const scope = await shipmentScope(user)
  if (scope) return { shipments: { some: scope } }
  return { id: "__no_access__" }
}

export async function userBranchId(user) {
  if (user.branchId !== undefined) return user.branchId
  return (await prisma.user.findUnique({ where: { id: user.id }, select: { branchId: true } }))?.branchId ?? null
}

// Which branch handles a place: exact city match first, then the branch of the same region.
export async function findBranchForCity(city, region) {
  if (!city) return null
  const byCity = await prisma.branch.findFirst({ where: { isActive: true, city: { equals: city.trim(), mode: "insensitive" } }, select: { id: true } })
  if (byCity) return byCity.id
  let regionName = region?.trim()
  if (!regionName) {
    const c = await prisma.city.findFirst({ where: { name: { equals: city.trim(), mode: "insensitive" } }, include: { region: true } })
    regionName = c?.region?.name
  }
  if (!regionName) return null
  const byRegion = await prisma.branch.findFirst({ where: { isActive: true, region: { equals: regionName, mode: "insensitive" } }, select: { id: true } })
  return byRegion?.id ?? null
}
