import { ASSIGNABLE_ROLES, normalizeRole } from "../utils/roles.js"

// ============================================================
// XERIN EXPRESS — RBAC PERMISSION SYSTEM
// Granular permissions mapped to roles
// ============================================================

// All permissions in the system
export const PERMISSIONS = {
  // Shipments
  SHIPMENTS_VIEW: "shipments.view",
  SHIPMENTS_CREATE: "shipments.create",
  SHIPMENTS_EDIT: "shipments.edit",
  SHIPMENTS_CANCEL: "shipments.cancel",
  SHIPMENTS_DELETE: "shipments.delete",
  SHIPMENTS_ASSIGN: "shipments.assign",

  // Payments
  PAYMENTS_VIEW: "payments.view",
  PAYMENTS_VERIFY: "payments.verify",
  PAYMENTS_REFUND: "payments.refund",
  PAYMENTS_MANAGE: "payments.manage",

  // Invoices & Receipts
  INVOICES_VIEW: "invoices.view",
  INVOICES_CREATE: "invoices.create",
  RECEIPTS_VIEW: "receipts.view",
  RECEIPTS_CREATE: "receipts.create",

  // Drivers
  DRIVERS_VIEW: "drivers.view",
  DRIVERS_ASSIGN: "drivers.assign",
  DRIVERS_MANAGE: "drivers.manage",

  // Dispatch
  DISPATCH_VIEW: "dispatch.view",
  DISPATCH_CREATE: "dispatch.create",
  DISPATCH_EDIT: "dispatch.edit",

  // Warehouse
  WAREHOUSE_VIEW: "warehouse.view",
  WAREHOUSE_RECEIVE: "warehouse.receive",
  WAREHOUSE_INSPECT: "warehouse.inspect",
  WAREHOUSE_MOVE: "warehouse.move",
  WAREHOUSE_DISPATCH: "warehouse.dispatch",
  WAREHOUSE_MANAGE: "warehouse.manage",

  // SGR
  SGR_VIEW: "sgr.view",
  SGR_RECEIVE: "sgr.receive",
  SGR_SCREEN: "sgr.screen",
  SGR_LOAD: "sgr.load",
  SGR_ARRIVAL: "sgr.arrival",

  // Air Cargo
  AIR_VIEW: "air.view",
  AIR_MANAGE: "air.manage",

  // Customs
  CUSTOMS_VIEW: "customs.view",
  CUSTOMS_REVIEW: "customs.review",
  CUSTOMS_HOLD: "customs.hold",
  CUSTOMS_RELEASE: "customs.release",

  // Pricing
  PRICING_VIEW: "pricing.view",
  PRICING_CREATE: "pricing.create",
  PRICING_EDIT: "pricing.edit",
  PRICING_DELETE: "pricing.delete",

  // Reports
  REPORTS_VIEW: "reports.view",
  REPORTS_EXPORT: "reports.export",
  REPORTS_FINANCIAL: "reports.financial",

  // Users & Roles
  USERS_VIEW: "users.view",
  USERS_CREATE: "users.create",
  USERS_EDIT: "users.edit",
  USERS_DELETE: "users.delete",
  USERS_CHANGE_ROLE: "users.change_role",
  USERS_TOGGLE_ACTIVE: "users.toggle_active",

  // System Settings
  SETTINGS_VIEW: "settings.view",
  SETTINGS_MANAGE: "settings.manage",
  SETTINGS_SYSTEM: "settings.system",

  // Audit
  AUDIT_VIEW: "audit.view",

  // Exceptions
  EXCEPTIONS_VIEW: "exceptions.view",
  EXCEPTIONS_CREATE: "exceptions.create",
  EXCEPTIONS_APPROVE: "exceptions.approve",

  // Notifications
  NOTIFICATIONS_VIEW: "notifications.view",
  NOTIFICATIONS_SEND: "notifications.send",
  NOTIFICATIONS_MANAGE: "notifications.manage",

  // Claims & Support
  CLAIMS_VIEW: "claims.view",
  CLAIMS_CREATE: "claims.create",
  CLAIMS_ESCALATE: "claims.escalate",
  CLAIMS_RESOLVE: "claims.resolve",
  TICKETS_VIEW: "tickets.view",
  TICKETS_CREATE: "tickets.create",
  TICKETS_UPDATE: "tickets.update",

  // Tracking
  TRACKING_VIEW: "tracking.view",
  TRACKING_MANAGE: "tracking.manage",

  // Stations & Routes
  STATIONS_VIEW: "stations.view",
  STATIONS_MANAGE: "stations.manage",
  ROUTES_VIEW: "routes.view",
  ROUTES_MANAGE: "routes.manage",

  // Integrations
  INTEGRATIONS_VIEW: "integrations.view",
  INTEGRATIONS_MANAGE: "integrations.manage",

  // Dubai<->Tanzania consolidation workflow (XERIN spec §4.2)
  DUBAI_RECEIVING_VIEW: "dubai_receiving.view",
  DUBAI_RECEIVING_CREATE: "dubai_receiving.create",
  DUBAI_RECEIVING_EDIT: "dubai_receiving.edit",
  CONSOLIDATION_VIEW: "consolidation.view",
  CONSOLIDATION_PACK: "consolidation.pack",
  CONSOLIDATION_MANAGE: "consolidation.manage",
  TRIP_MANIFEST_VIEW: "trip_manifest.view",
  TRIP_MANIFEST_CREATE: "trip_manifest.create",
  TRIP_MANIFEST_DEPART: "trip_manifest.depart",
  TRIP_MANIFEST_ARRIVE: "trip_manifest.arrive",
  TZ_RECEIVING_VIEW: "tz_receiving.view",
  TZ_RECEIVING_RECEIVE: "tz_receiving.receive",
  TZ_RECEIVING_SORT: "tz_receiving.sort",
  APPROVALS_VIEW: "approvals.view",
  APPROVALS_REQUEST: "approvals.request",
  APPROVALS_DECIDE: "approvals.decide",
  SUPPLIERS_VIEW: "suppliers.view",
  SUPPLIERS_MANAGE: "suppliers.manage",
}

// ─── Role → permission mapping ─────────────────────────────────────────
// Four staff roles + the two external user types. See src/utils/roles.js for
// the model. Each staff role is the union of the duties of the roles it absorbed.

const P = PERMISSIONS

const FINANCE_PERMISSIONS = [
  // payments, invoices, receipts (was FINANCE / ACCOUNTANT)
  P.PAYMENTS_VIEW, P.PAYMENTS_VERIFY, P.PAYMENTS_REFUND, P.PAYMENTS_MANAGE,
  P.INVOICES_VIEW, P.INVOICES_CREATE, P.RECEIPTS_VIEW, P.RECEIPTS_CREATE,
  // payment approvals — maker/checker is enforced per user (a requester can never approve their own request)
  P.APPROVALS_VIEW, P.APPROVALS_REQUEST, P.APPROVALS_DECIDE,
  // pricing (was PRICING_MANAGER)
  P.PRICING_VIEW, P.PRICING_CREATE, P.PRICING_EDIT, P.PRICING_DELETE,
  // reports (was REPORT_VIEWER)
  P.REPORTS_VIEW, P.REPORTS_EXPORT, P.REPORTS_FINANCIAL,
  P.SUPPLIERS_VIEW,
  P.SHIPMENTS_VIEW, P.TRACKING_VIEW, P.NOTIFICATIONS_VIEW,
]

const WAREHOUSE_PERMISSIONS = [
  // warehouse (was WAREHOUSE_MANAGER / WAREHOUSE_OFFICER)
  P.WAREHOUSE_VIEW, P.WAREHOUSE_RECEIVE, P.WAREHOUSE_INSPECT, P.WAREHOUSE_MOVE, P.WAREHOUSE_DISPATCH, P.WAREHOUSE_MANAGE,
  // SGR station cargo (was SGR_STATION_OFFICER)
  P.SGR_VIEW, P.SGR_RECEIVE, P.SGR_SCREEN, P.SGR_LOAD, P.SGR_ARRIVAL,
  P.STATIONS_VIEW,
  // Dubai <-> Tanzania consolidation (was DUBAI_RECEIVING / CONSOLIDATION / TRIP_COORDINATOR / TZ_RECEIVING)
  P.DUBAI_RECEIVING_VIEW, P.DUBAI_RECEIVING_CREATE, P.DUBAI_RECEIVING_EDIT,
  P.CONSOLIDATION_VIEW, P.CONSOLIDATION_PACK, P.CONSOLIDATION_MANAGE,
  P.TRIP_MANIFEST_VIEW, P.TRIP_MANIFEST_CREATE, P.TRIP_MANIFEST_DEPART, P.TRIP_MANIFEST_ARRIVE,
  P.TZ_RECEIVING_VIEW, P.TZ_RECEIVING_RECEIVE, P.TZ_RECEIVING_SORT,
  P.SUPPLIERS_VIEW,
  // must SEE the debt/approval state to gate release of goods
  P.APPROVALS_VIEW,
  P.SHIPMENTS_VIEW, P.SHIPMENTS_CREATE,
  P.EXCEPTIONS_VIEW, P.EXCEPTIONS_CREATE,
  P.REPORTS_VIEW, P.TRACKING_VIEW, P.NOTIFICATIONS_VIEW,
]

// Branch roles get the smallest useful set: the data is further narrowed to their branch / their
// tasks by utils/branch-scope.js, so a permission here never means "everything".
const BRANCH_MANAGER_PERMISSIONS = [
  P.SHIPMENTS_VIEW, P.TRACKING_VIEW,
  P.WAREHOUSE_VIEW, P.WAREHOUSE_RECEIVE,
  P.EXCEPTIONS_VIEW, P.EXCEPTIONS_CREATE,
  P.NOTIFICATIONS_VIEW,
]
const AGENT_PERMISSIONS = [P.SHIPMENTS_VIEW, P.TRACKING_VIEW, P.EXCEPTIONS_CREATE, P.NOTIFICATIONS_VIEW]

export const ROLE_PERMISSIONS = {
  SUPER_ADMIN: Object.values(PERMISSIONS), // everything
  OPERATIONS_MANAGER: Object.values(PERMISSIONS), // IT / Operations — Super Admin privileges
  FINANCE: FINANCE_PERMISSIONS,
  WAREHOUSE_MANAGER: WAREHOUSE_PERMISSIONS,
  BRANCH_MANAGER: BRANCH_MANAGER_PERMISSIONS,
  AGENT: AGENT_PERMISSIONS,

  CUSTOMER: [
    P.SHIPMENTS_VIEW, P.SHIPMENTS_CREATE,
    P.PAYMENTS_VIEW,
    P.TRACKING_VIEW,
    P.CLAIMS_VIEW, P.CLAIMS_CREATE,
    P.TICKETS_VIEW, P.TICKETS_CREATE,
    P.NOTIFICATIONS_VIEW,
  ],

  DRIVER: [
    P.SHIPMENTS_VIEW,
    P.TRACKING_VIEW,
    P.EXCEPTIONS_VIEW, P.EXCEPTIONS_CREATE,
    P.NOTIFICATIONS_VIEW,
  ],

  // Not a real login identity — see getOrCreateIntegrationSystemUser(). Holds zero normal
  // JWT-auth permissions; partner API requests are authorized entirely via authenticatePartner()
  // + requireScope(), never via this role.
  PARTNER_API: [],
}

// Get all permissions for a role
export function getRolePermissions(role) {
  return ROLE_PERMISSIONS[normalizeRole(role)] || []
}

// Check if a role has a specific permission
export function hasPermission(role, permission) {
  return getRolePermissions(role).includes(permission)
}

// Check if a role has any of the given permissions
export function hasAnyPermission(role, permissions) {
  const perms = getRolePermissions(role)
  return permissions.some((p) => perms.includes(p))
}

// Check if a role has all of the given permissions
export function hasAllPermissions(role, permissions) {
  const perms = getRolePermissions(role)
  return permissions.every((p) => perms.includes(p))
}

// Roles an admin can see/assign (PARTNER_API is a system identity, never assignable)
export const ALL_ROLES = ASSIGNABLE_ROLES

// Role labels for display
export const ROLE_LABELS = {
  SUPER_ADMIN: "Super Admin",
  OPERATIONS_MANAGER: "Operations (IT)",
  FINANCE: "Finance",
  WAREHOUSE_MANAGER: "Warehouse",
  BRANCH_MANAGER: "Branch Manager",
  AGENT: "Agent",
  CUSTOMER: "Customer",
  DRIVER: "Driver",
  PARTNER_API: "Partner API",
}

// Role hierarchy for display
export const ROLE_HIERARCHY = {
  SUPER_ADMIN: 0,
  OPERATIONS_MANAGER: 0,
  FINANCE: 1,
  WAREHOUSE_MANAGER: 1,
  BRANCH_MANAGER: 1,
  AGENT: 2,
  CUSTOMER: 2,
  DRIVER: 2,
}
