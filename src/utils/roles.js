// ============================================================
// XERIN EXPRESS — ROLE MODEL (single source of truth)
// ============================================================
// Four staff roles, plus the two external user types:
//
//   SUPER_ADMIN         Main admin — owns the business, sees everything.
//   OPERATIONS_MANAGER  Operations / IT — carries Super Admin privileges
//                       (wherever SUPER_ADMIN is allowed, so is this role).
//   FINANCE             Payments, invoicing, approvals, pricing, reports.
//   WAREHOUSE_MANAGER   Warehouse, receiving, consolidation, SGR station cargo.
//   BRANCH_MANAGER      Runs one branch — sees and acts on that branch only.
//   AGENT               Clearing / forwarding / receiving partner tied to a branch;
//                       sees only the shipments they were given a task on.
//   CUSTOMER / DRIVER   External users.
//   PARTNER_API         System identity for partner integrations — never a login.
// ============================================================

export const STAFF_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "FINANCE", "WAREHOUSE_MANAGER", "BRANCH_MANAGER"]

// Branch-bound roles: they always belong to one branch and only see that branch's work.
//   BRANCH_MANAGER  runs a branch (Dar es Salaam, Mwanza, Kagera…)
//   AGENT           clearing / forwarding / receiving partner working for a branch
export const BRANCH_BOUND_ROLES = ["BRANCH_MANAGER", "AGENT"]

// Roles an admin may assign to a user. PARTNER_API is deliberately excluded.
export const ASSIGNABLE_ROLES = [...STAFF_ROLES, "AGENT", "CUSTOMER", "DRIVER"]

export const SUPERUSER_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER"]

export function isSuperUser(role) {
  return SUPERUSER_ROLES.includes(role)
}

// Roles that existed before the consolidation, and the role that inherited their duties.
// Only used by the one-off data migration and by tooling that may still meet old values.
export const LEGACY_ROLE_MAP = {
  DISPATCHER: "OPERATIONS_MANAGER",
  CUSTOMER_SUPPORT: "OPERATIONS_MANAGER",
  CUSTOMS_OFFICER: "OPERATIONS_MANAGER",
  SGR_STATION_OFFICER: "WAREHOUSE_MANAGER",
  DUBAI_RECEIVING_OFFICER: "WAREHOUSE_MANAGER",
  CONSOLIDATION_OFFICER: "WAREHOUSE_MANAGER",
  TRIP_COORDINATOR: "WAREHOUSE_MANAGER",
  TZ_RECEIVING_OFFICER: "WAREHOUSE_MANAGER",
  WAREHOUSE_OFFICER: "WAREHOUSE_MANAGER",
  PRICING_MANAGER: "FINANCE",
  REPORT_VIEWER: "FINANCE",
  ACCOUNTANT: "FINANCE",
  FINANCE_APPROVER: "FINANCE",
}

export function normalizeRole(role) {
  return LEGACY_ROLE_MAP[role] || role
}
