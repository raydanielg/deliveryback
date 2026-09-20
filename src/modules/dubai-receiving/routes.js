import { Router } from "express"
import {
  receiveDubai,
  listDubaiReceiving,
  getDubaiShipment,
  updateDubaiReceiving,
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  listItemTypes,
} from "./controller.js"
import { authenticate, authorizePermission } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// Dubai Receiving (Module 1)
router.get("/shipments", authorizePermission("dubai_receiving.view"), listDubaiReceiving)
router.post("/receive", authorizePermission("dubai_receiving.create"), receiveDubai)
router.get("/shipments/:id", authorizePermission("dubai_receiving.view"), getDubaiShipment)
router.patch("/shipments/:id", authorizePermission("dubai_receiving.edit"), updateDubaiReceiving)

// Config lists
router.get("/item-types", authorizePermission("dubai_receiving.view"), listItemTypes)
router.get("/suppliers", authorizePermission("suppliers.view"), listSuppliers)
router.post("/suppliers", authorizePermission("suppliers.manage"), createSupplier)
router.patch("/suppliers/:id", authorizePermission("suppliers.manage"), updateSupplier)
router.delete("/suppliers/:id", authorizePermission("suppliers.manage"), deleteSupplier)

export default router
