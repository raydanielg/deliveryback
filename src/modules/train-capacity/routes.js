import { Router } from "express"
import { listTrains, getTrain, createTrain, updateTrain, deleteTrain, toggleTrain } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

router.get("/", listTrains)
router.get("/:id", getTrain)

router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "SGR_STATION_OFFICER"), createTrain)
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "SGR_STATION_OFFICER"), updateTrain)
router.delete("/:id", authorizeRoles("SUPER_ADMIN"), deleteTrain)
router.patch("/:id/toggle", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), toggleTrain)

export default router
