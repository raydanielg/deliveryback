import { Router } from "express"
import {
  listTickets, getTicket, createTicket,
  updateTicketStatus, assignTicket, createReply, getTicketStats,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"
import { auditMiddleware } from "../../middleware/audit-logger.js"

const router = Router()

const STAFF_ROLES = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"]

router.use(authenticate)

router.get("/", listTickets)
router.get("/stats", authorizeRoles(...STAFF_ROLES), getTicketStats)
router.get("/:id", getTicket)

router.post("/", auditMiddleware("ticket"), createTicket)
router.post("/:id/replies", createReply)

router.patch("/:id/status", authorizeRoles(...STAFF_ROLES), auditMiddleware("ticket"), updateTicketStatus)
router.patch("/:id/assign", authorizeRoles(...STAFF_ROLES), auditMiddleware("ticket"), assignTicket)

export default router
