import { Router } from "express"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"
import {
  listBranches, listAgents, getBranch, createBranch, updateBranch,
  createTask, listTasks, updateTaskStatus,
  raiseEmergency, listEmergencies, updateEmergency,
} from "./controller.js"

/**
 * @swagger
 * tags:
 *   name: Branches
 *   description: Branches, branch agents' tasks, and emergencies
 */

const router = Router()
router.use(authenticate)

// Branch directory — a branch manager only ever gets their own branch back.
router.get("/", authorizeRoles("SUPER_ADMIN", "BRANCH_MANAGER"), listBranches)
router.post("/", authorizeRoles("SUPER_ADMIN"), createBranch)

router.get("/agents", authorizeRoles("SUPER_ADMIN", "BRANCH_MANAGER"), listAgents)

// Agent tasks (clearing / forwarding / receiving)
router.get("/tasks", authorizeRoles("SUPER_ADMIN", "BRANCH_MANAGER", "AGENT"), listTasks)
router.post("/tasks", authorizeRoles("SUPER_ADMIN", "BRANCH_MANAGER"), createTask)
router.patch("/tasks/:id/status", authorizeRoles("SUPER_ADMIN", "BRANCH_MANAGER", "AGENT"), updateTaskStatus)

router.get("/:id", authorizeRoles("SUPER_ADMIN", "BRANCH_MANAGER"), getBranch)
router.put("/:id", authorizeRoles("SUPER_ADMIN"), updateBranch)

export const emergencyRouter = Router()
emergencyRouter.use(authenticate)
emergencyRouter.post("/", authorizeRoles("SUPER_ADMIN", "WAREHOUSE_MANAGER", "BRANCH_MANAGER", "AGENT", "DRIVER"), raiseEmergency)
emergencyRouter.get("/", authorizeRoles("SUPER_ADMIN", "WAREHOUSE_MANAGER", "BRANCH_MANAGER", "AGENT", "DRIVER"), listEmergencies)
emergencyRouter.patch("/:id", authorizeRoles("SUPER_ADMIN", "BRANCH_MANAGER"), updateEmergency)

export default router
