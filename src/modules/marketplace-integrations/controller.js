import prisma from "../../prisma/client.js"

// In-memory store for marketplace integrations
// In production this would be persisted in DB, but follows the same pattern as settings module
let integrationsState = []

// Default integrations seeded on first load
let seeded = false

function seedDefaults() {
  if (seeded) return
  seeded = true
  integrationsState = [
    {
      id: "dhl",
      name: "DHL Marketplace",
      provider: "DHL",
      apiBaseUrl: "https://provider.example/api",
      outboundWebhookUrl: "https://provider.example/webhooks/xerin",
      authType: "API_KEY",
      credentialEnvRef: "DHL_API_KEY",
      webhookSecretRef: "DHL_WEBHOOK_SECRET",
      apiKeyHeader: "X-API-Key",
      isActive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]
}

function maskSecret(value) {
  if (!value) return ""
  if (value.length > 8) {
    return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
  }
  return "••••••••"
}

function maskIntegration(integration) {
  return {
    ...integration,
    apiKey: integration.apiKey ? maskSecret(integration.apiKey) : "",
    webhookSecret: integration.webhookSecret ? maskSecret(integration.webhookSecret) : "",
  }
}

export async function listIntegrations(req, res, next) {
  try {
    seedDefaults()
    res.json({
      success: true,
      data: integrationsState.map(maskIntegration),
    })
  } catch (err) {
    next(err)
  }
}

export async function getIntegration(req, res, next) {
  try {
    seedDefaults()
    const integration = integrationsState.find((i) => i.id === req.params.id)
    if (!integration) {
      return res.status(404).json({ success: false, message: "Integration not found" })
    }
    res.json({ success: true, data: maskIntegration(integration) })
  } catch (err) {
    next(err)
  }
}

export async function createIntegration(req, res, next) {
  try {
    const {
      name,
      provider,
      apiBaseUrl,
      outboundWebhookUrl,
      authType,
      credentialEnvRef,
      webhookSecretRef,
      apiKeyHeader,
      apiKey,
      webhookSecret,
      isActive,
    } = req.body

    const id = provider.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Date.now().toString(36)

    const integration = {
      id,
      name: name || provider,
      provider,
      apiBaseUrl: apiBaseUrl || "",
      outboundWebhookUrl: outboundWebhookUrl || "",
      authType: authType || "API_KEY",
      credentialEnvRef: credentialEnvRef || "",
      webhookSecretRef: webhookSecretRef || "",
      apiKeyHeader: apiKeyHeader || "X-API-Key",
      apiKey: apiKey || "",
      webhookSecret: webhookSecret || "",
      isActive: isActive ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    integrationsState.push(integration)

    res.status(201).json({
      success: true,
      message: "Marketplace integration created successfully",
      data: maskIntegration(integration),
    })
  } catch (err) {
    next(err)
  }
}

export async function updateIntegration(req, res, next) {
  try {
    seedDefaults()
    const integration = integrationsState.find((i) => i.id === req.params.id)
    if (!integration) {
      return res.status(404).json({ success: false, message: "Integration not found" })
    }

    const updates = req.body
    for (const [key, value] of Object.entries(updates)) {
      // Don't overwrite secrets with masked values
      if ((key === "apiKey" || key === "webhookSecret") && typeof value === "string" && value.includes("•••")) {
        continue
      }
      if (key in integration) {
        integration[key] = value
      }
    }
    integration.updatedAt = new Date().toISOString()

    res.json({
      success: true,
      message: "Integration updated successfully",
      data: maskIntegration(integration),
    })
  } catch (err) {
    next(err)
  }
}

export async function deleteIntegration(req, res, next) {
  try {
    seedDefaults()
    const idx = integrationsState.findIndex((i) => i.id === req.params.id)
    if (idx === -1) {
      return res.status(404).json({ success: false, message: "Integration not found" })
    }
    integrationsState.splice(idx, 1)
    res.json({ success: true, message: "Integration deleted successfully" })
  } catch (err) {
    next(err)
  }
}

export async function toggleIntegration(req, res, next) {
  try {
    seedDefaults()
    const integration = integrationsState.find((i) => i.id === req.params.id)
    if (!integration) {
      return res.status(404).json({ success: false, message: "Integration not found" })
    }
    integration.isActive = !integration.isActive
    integration.updatedAt = new Date().toISOString()

    res.json({
      success: true,
      message: `Integration ${integration.isActive ? "activated" : "deactivated"}`,
      data: maskIntegration(integration),
    })
  } catch (err) {
    next(err)
  }
}

// Inbound webhook receiver — receives orders from marketplace providers
export async function receiveWebhook(req, res, next) {
  try {
    const { provider } = req.params
    const payload = req.body

    // Verify webhook secret if provided in headers
    const webhookSecret = req.headers["x-webhook-secret"] || req.headers["x-api-key"]
    if (!webhookSecret) {
      return res.status(401).json({ success: false, message: "Missing authentication header" })
    }

    // Find matching integration
    seedDefaults()
    const integration = integrationsState.find(
      (i) => i.provider.toLowerCase() === provider.toLowerCase() && i.isActive
    )
    if (!integration) {
      return res.status(404).json({ success: false, message: `No active integration found for provider: ${provider}` })
    }

    // Verify secret matches (in production, use constant-time comparison)
    if (integration.webhookSecret && webhookSecret !== integration.webhookSecret) {
      return res.status(401).json({ success: false, message: "Invalid webhook secret" })
    }

    // Process the incoming order from marketplace
    // This would create a shipment/order in the system based on the payload
    // For now, we acknowledge receipt and log it
    console.log(`[Marketplace Webhook] Received order from ${provider}:`, JSON.stringify(payload))

    res.json({
      success: true,
      message: `Webhook received from ${provider}`,
      data: {
        received: true,
        provider,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err) {
    next(err)
  }
}

// Test connection to provider API
export async function testConnection(req, res, next) {
  try {
    seedDefaults()
    const integration = integrationsState.find((i) => i.id === req.params.id)
    if (!integration) {
      return res.status(404).json({ success: false, message: "Integration not found" })
    }

    if (!integration.apiBaseUrl) {
      return res.status(400).json({ success: false, message: "API base URL not configured" })
    }

    // Attempt a simple health check to the provider's API
    const headers = {}
    if (integration.apiKey && integration.apiKeyHeader) {
      headers[integration.apiKeyHeader] = integration.apiKey
    }

    try {
      const response = await fetch(`${integration.apiBaseUrl}/health`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10000),
      })

      if (response.ok) {
        res.json({
          success: true,
          message: "Connection successful",
          data: { status: response.status, ok: true },
        })
      } else {
        res.json({
          success: false,
          message: `Provider returned status ${response.status}`,
          data: { status: response.status, ok: false },
        })
      }
    } catch (fetchErr) {
      res.json({
        success: false,
        message: `Connection failed: ${fetchErr.message}`,
        data: { ok: false, error: fetchErr.message },
      })
    }
  } catch (err) {
    next(err)
  }
}
