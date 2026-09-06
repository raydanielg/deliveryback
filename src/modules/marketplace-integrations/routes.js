import { Router } from "express"
import {
  listIntegrations,
  getIntegration,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  toggleIntegration,
  receiveWebhook,
  testConnection,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

/**
 * @swagger
 * /api/v1/marketplace-integrations:
 *   get:
 *     summary: List all marketplace integrations
 *     description: Returns all configured marketplace provider integrations. Sensitive credentials are masked.
 *     tags: [Marketplace Integrations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of integrations
 */
router.get("/", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER"]), listIntegrations)

/**
 * @swagger
 * /api/v1/marketplace-integrations/{id}:
 *   get:
 *     summary: Get a single integration
 *     tags: [Marketplace Integrations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Integration details
 *       404:
 *         description: Integration not found
 */
router.get("/:id", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER"]), getIntegration)

/**
 * @swagger
 * /api/v1/marketplace-integrations:
 *   post:
 *     summary: Create a new marketplace integration
 *     tags: [Marketplace Integrations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               provider: { type: string, description: "Provider name e.g. DHL" }
 *               apiBaseUrl: { type: string, format: uri }
 *               outboundWebhookUrl: { type: string, format: uri }
 *               authType: { type: string, enum: [API_KEY, BEARER_TOKEN, NONE] }
 *               credentialEnvRef: { type: string, description: "Env variable reference e.g. DHL_API_KEY" }
 *               webhookSecretRef: { type: string, description: "Env variable reference e.g. DHL_WEBHOOK_SECRET" }
 *               apiKeyHeader: { type: string, description: "Header name for API key e.g. X-API-Key" }
 *               apiKey: { type: string, description: "Actual API key value" }
 *               webhookSecret: { type: string, description: "Actual webhook secret value" }
 *               isActive: { type: boolean }
 *     responses:
 *       201:
 *         description: Integration created
 */
router.post("/", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER"]), createIntegration)

/**
 * @swagger
 * /api/v1/marketplace-integrations/{id}:
 *   put:
 *     summary: Update an integration
 *     tags: [Marketplace Integrations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Integration updated
 *       404:
 *         description: Integration not found
 */
router.put("/:id", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER"]), updateIntegration)

/**
 * @swagger
 * /api/v1/marketplace-integrations/{id}:
 *   delete:
 *     summary: Delete an integration
 *     tags: [Marketplace Integrations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Integration deleted
 *       404:
 *         description: Integration not found
 */
router.delete("/:id", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER"]), deleteIntegration)

/**
 * @swagger
 * /api/v1/marketplace-integrations/{id}/toggle:
 *   patch:
 *     summary: Toggle integration active status
 *     tags: [Marketplace Integrations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Integration toggled
 */
router.patch("/:id/toggle", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER"]), toggleIntegration)

/**
 * @swagger
 * /api/v1/marketplace-integrations/{id}/test:
 *   post:
 *     summary: Test connection to provider API
 *     description: Attempts a health check to the provider's API base URL using configured credentials.
 *     tags: [Marketplace Integrations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Connection test result
 */
router.post("/:id/test", authenticate, authorizeRoles(["SUPER_ADMIN", "OPERATIONS_MANAGER"]), testConnection)

/**
 * @swagger
 * /api/v1/marketplace-integrations/webhooks/{provider}:
 *   post:
 *     summary: Receive inbound webhook from marketplace provider
 *     description: Public endpoint that receives order/webhook payloads from external marketplace providers. Authentication via X-API-Key or X-Webhook-Secret header.
 *     tags: [Marketplace Integrations]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Webhook payload from provider
 *     responses:
 *       200:
 *         description: Webhook received
 *       401:
 *         description: Missing or invalid authentication
 *       404:
 *         description: No active integration for provider
 */
router.post("/webhooks/:provider", receiveWebhook)

export default router
