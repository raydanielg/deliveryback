import { Router } from "express"
import {
  listExceptions, getException, createException, updateException,
  createReturn, resolveException, escalateException, getExceptionStats,
  createDriverReport,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// Reads previously had no role check at all, exposing sender/recipient name+phone+city
// for every shipment exception system-wide to any authenticated CUSTOMER. Match the
// write-path audience (staff + DRIVER) already enforced below.
const EXCEPTIONS_STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "DRIVER"]
router.get("/", authorizeRoles(...EXCEPTIONS_STAFF), listExceptions)
router.get("/stats", authorizeRoles(...EXCEPTIONS_STAFF), getExceptionStats)
router.get("/:id", authorizeRoles(...EXCEPTIONS_STAFF), getException)

router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "DRIVER"), createException)
router.post("/return", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "DRIVER"), createReturn)
router.post("/report", authorizeRoles("DRIVER", "SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), createDriverReport)

router.patch("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateException)
router.patch("/:id/resolve", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), resolveException)
router.patch("/:id/escalate", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), escalateException)

export default router
