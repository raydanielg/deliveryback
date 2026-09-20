import { Router } from "express"
import { listCustomers, lookupCustomer, createCustomer, getCustomer, updateCustomer, setCustomerStatus, getCustomerStats } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

const VIEW_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "FINANCE", "WAREHOUSE_MANAGER"]
const MANAGE_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "WAREHOUSE_MANAGER"]

// Staff-only — the customer mobile app never calls these routes.
router.get("/", authorizeRoles(...VIEW_ROLES), listCustomers)

// Phone/code/name lookup for Dubai receiving — must be registered before /:id.
router.get("/lookup", authorizeRoles(...VIEW_ROLES), lookupCustomer)

router.post("/", authorizeRoles(...MANAGE_ROLES), createCustomer)

router.get("/:id", authorizeRoles(...VIEW_ROLES), getCustomer)

router.put("/:id", authorizeRoles(...MANAGE_ROLES), updateCustomer)

// Suspend/reactivate — spec §4.3: never delete, suspend instead.
router.patch("/:id/status", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), setCustomerStatus)

router.get("/:id/stats", authorizeRoles(...VIEW_ROLES), getCustomerStats)

export default router
