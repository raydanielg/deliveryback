import { Router } from "express"
import {
  listShelves, searchShelf, createShelf, assignBoxToShelf, assignShipmentToShelf,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()
const STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "WAREHOUSE_MANAGER"]

router.use(authenticate)
router.use(authorizeRoles(...STAFF))

router.get("/", listShelves)
router.get("/search", searchShelf)
router.post("/", createShelf)
router.post("/:id/assign-box", assignBoxToShelf)
router.post("/:id/assign-shipment", assignShipmentToShelf)

export default router
