import { z } from "zod"

export const createUserSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email().toLowerCase().trim(),
  phone: z.string().min(10).max(20).optional(),
  password: z.string().min(8).max(100),
  role: z.enum([
    "SUPER_ADMIN",
    "OPERATIONS_MANAGER",
    "DISPATCHER",
    "FINANCE",
    "CUSTOMER_SUPPORT",
    "WAREHOUSE_MANAGER",
    "CUSTOMS_OFFICER",
    "REPORT_VIEWER",
    "CUSTOMER",
    "DRIVER",
  ]),
  isActive: z.boolean().default(true),
})

export const updateUserSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  email: z.string().email().toLowerCase().trim().optional(),
  phone: z.string().min(10).max(20).optional(),
  role: z.enum([
    "SUPER_ADMIN",
    "OPERATIONS_MANAGER",
    "DISPATCHER",
    "FINANCE",
    "CUSTOMER_SUPPORT",
    "WAREHOUSE_MANAGER",
    "CUSTOMS_OFFICER",
    "REPORT_VIEWER",
    "CUSTOMER",
    "DRIVER",
  ]).optional(),
  isActive: z.boolean().optional(),
  avatar: z.string().url().optional(),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100)
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
})
