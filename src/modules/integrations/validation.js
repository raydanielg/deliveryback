import { z } from "zod"
import { EVENTS } from "./event-bus.js"

const VALID_EVENTS = Object.values(EVENTS)

const authConfigSchema = z.object({
  headerName: z.string().optional(),
  apiKey: z.string().optional(),
  token: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  authorizationUrl: z.string().optional(),
  tokenUrl: z.string().optional(),
  scopes: z.string().optional(),
  headerValue: z.string().optional(),
}).partial()

export const createPartnerSchema = z.object({
  name: z.string().min(2).max(150),
  company: z.string().max(150).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(30).optional(),
  apiBaseUrl: z.string().url().optional().or(z.literal("")),
  authMethod: z.enum(["NONE", "API_KEY", "BEARER", "BASIC", "OAUTH2", "CUSTOM"]).default("NONE"),
  authConfig: authConfigSchema.optional(),
  webhookUrl: z.string().url().optional().or(z.literal("")),
  webhookSecret: z.string().optional(),
  subscribedEvents: z.array(z.enum(VALID_EVENTS)).default([]),
  scopes: z.array(z.string()).default([]),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING", "ERROR"]).default("PENDING"),
  notes: z.string().max(2000).optional(),
})

export const updatePartnerSchema = createPartnerSchema.partial()

export const createApiKeySchema = z.object({
  label: z.string().max(100).optional(),
  environment: z.enum(["live", "test"]).default("live"),
  scopes: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional(),
})
