import { Router } from "express"
import {
  listBoxes, getBox, createBox, addBoxItem, removeBoxItem, closeBox, setBoxStatus, getBoxLabel,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()
const STAFF = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "WAREHOUSE_MANAGER"]

router.use(authenticate)

router.get("/", authorizeRoles(...STAFF), listBoxes)
router.get("/:id", authorizeRoles(...STAFF), getBox)
router.get("/:id/label.png", authorizeRoles(...STAFF), getBoxLabel)
router.post("/", authorizeRoles(...STAFF), createBox)
router.post("/:id/items", authorizeRoles(...STAFF), addBoxItem)
router.delete("/:id/items/:shipmentId", authorizeRoles(...STAFF), removeBoxItem)
router.post("/:id/close", authorizeRoles(...STAFF), closeBox)
router.post("/:id/status", authorizeRoles(...STAFF), setBoxStatus)

export default router
