import { Router } from "express"
import {
  calculateQuoteHandler, getMultipleQuotes, saveQuote,
  listQuotes, getQuote,
  createQuoteRequest, listQuoteRequests,
  respondToQuoteRequest, customerRespondToQuote,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

router.use(authenticate)

// Quote calculation
router.post("/calculate", calculateQuoteHandler)
router.post("/multiple", getMultipleQuotes)
router.post("/save", saveQuote)
router.get("/", listQuotes)
router.get("/:id", getQuote)

// Quote requests (custom quotes for heavy cargo)
router.post("/requests", createQuoteRequest)
router.get("/requests", listQuoteRequests)
router.put("/requests/:id/respond", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER"), respondToQuoteRequest)
router.put("/requests/:id/customer-respond", customerRespondToQuote)

export default router
