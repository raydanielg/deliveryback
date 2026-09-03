import { Router } from "express"
import { listCustomers, createCustomer, getCustomer, updateCustomer, getCustomerStats } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listCustomers)
router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"), createCustomer)
router.get("/:id", getCustomer)
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"), updateCustomer)
router.get("/:id/stats", getCustomerStats)

export default router
