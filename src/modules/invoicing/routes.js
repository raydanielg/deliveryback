import { Router } from "express"
import {
  previewInvoice,
  listInvoices,
  getInvoice,
  createInvoice,
  bulkCreateInvoices,
  recordPayment,
  reopenInvoice,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

// Spec §4.2 — Accounting/Invoicing: Accountant operates, Finance Approver manages,
// Warehouse/Dispatch/Customer Service view (they must see the debt to gate release).
const VIEW_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "FINANCE", "WAREHOUSE_MANAGER"]
const MANAGE_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "FINANCE"]
const REOPEN_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER"]

router.use(authenticate)

router.get("/", authorizeRoles(...VIEW_ROLES), listInvoices)
router.get("/preview/:shipmentId", authorizeRoles(...VIEW_ROLES), previewInvoice)
router.get("/:id", authorizeRoles(...VIEW_ROLES), getInvoice)
router.post("/", authorizeRoles(...MANAGE_ROLES), createInvoice)
router.post("/bulk", authorizeRoles(...MANAGE_ROLES), bulkCreateInvoices)
router.post("/:id/payment", authorizeRoles(...MANAGE_ROLES), recordPayment)
router.post("/:id/reopen", authorizeRoles(...REOPEN_ROLES), reopenInvoice)

export default router
