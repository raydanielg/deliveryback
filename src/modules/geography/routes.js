import { Router } from "express"
import { listCountries, createCountry, listCities, createCity, listRoutes, createRoute } from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

// Public read access
router.get("/countries", listCountries)
router.get("/cities", listCities)
router.get("/routes", listRoutes)

router.use(authenticate)

router.post("/countries", authorizeRoles("SUPER_ADMIN"), createCountry)
router.post("/cities", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createCity)
router.post("/routes", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createRoute)

export default router
