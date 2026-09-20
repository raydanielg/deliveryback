import { Router } from "express"
import jwt from "jsonwebtoken"
import prisma from "../../prisma/client.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"
import {
  listVehicleClasses, searchDestinations, listRegions, searchAirports, estimate,
  createVehicleClass, updateVehicleClass, listServiceLevels, updateServiceLevel,
  blockCity, blockRegion, blockAirport, setCityActive, setAirportActive, updateCity, createAirport,
} from "./controller.js"

const router = Router()

// Optional identity on public reads: an anonymous visitor sees the customer view; a signed-in
// Super Admin / Operations user asking for `?all=1` also sees switched-off entries.
async function softAuth(req, _res, next) {
  const header = req.headers.authorization
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET)
      const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, role: true, isActive: true } })
      if (user?.isActive) req.user = user
    } catch { /* anonymous */ }
  }
  next()
}

/**
 * @swagger
 * tags:
 *   name: Logistics
 *   description: Destinations, airports, vehicle classes and journey estimates (data-driven, editable by Super Admin)
 */

// ---- public ----
router.get("/vehicle-classes", softAuth, listVehicleClasses)
router.get("/destinations", softAuth, searchDestinations)
router.get("/regions", softAuth, listRegions)
router.get("/airports", softAuth, searchAirports)
router.get("/service-levels", listServiceLevels)
router.post("/estimate", estimate)

// ---- admin: Super Admin (Operations/IT is admitted automatically) ----
router.use(authenticate, authorizeRoles("SUPER_ADMIN"))
router.post("/vehicle-classes", createVehicleClass)
router.put("/vehicle-classes/:id", updateVehicleClass)
router.put("/service-levels/:level", updateServiceLevel)
router.put("/cities/:id", updateCity)
router.patch("/cities/:id/block", blockCity)
router.patch("/cities/:id/active", setCityActive)
router.patch("/regions/:id/block", blockRegion)
router.post("/airports", createAirport)
router.patch("/airports/:id/block", blockAirport)
router.patch("/airports/:id/active", setAirportActive)

export default router
