import { z } from "zod"
import { ASSIGNABLE_ROLES } from "../../utils/roles.js"

const AGENT_KINDS = ["CLEARING", "FORWARDING", "RECEIVING"]

export const createUserSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email().toLowerCase().trim(),
  phone: z.string().min(10).max(20).optional(),
  password: z.string().min(8).max(100),
  role: z.enum(ASSIGNABLE_ROLES),
  isActive: z.boolean().default(true),
  // Branch managers and agents belong to a branch; agents also have a kind of work.
  branchId: z.string().min(1).optional(),
  agentKind: z.enum(AGENT_KINDS).optional(),
}).superRefine((d, ctx) => {
  if ((d.role === "BRANCH_MANAGER" || d.role === "AGENT") && !d.branchId) ctx.addIssue({ code: "custom", path: ["branchId"], message: "Choose the branch this person works for" })
  if (d.role === "AGENT" && !d.agentKind) ctx.addIssue({ code: "custom", path: ["agentKind"], message: "Choose the agent's kind of work (clearing, forwarding or receiving)" })
})

export const updateUserSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  email: z.string().email().toLowerCase().trim().optional(),
  phone: z.string().min(10).max(20).optional(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  isActive: z.boolean().optional(),
  avatar: z.string().url().optional(),
  branchId: z.string().min(1).nullable().optional(),
  agentKind: z.enum(AGENT_KINDS).nullable().optional(),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100)
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
})

// Admin-side provisioning of a staff member's shared-device PIN/badge login.
export const staffCredentialsSchema = z.object({
  badgeCode: z.string().min(1).max(50),
  pin: z.string().min(4).max(8).regex(/^\d+$/, "PIN must contain only digits"),
})
