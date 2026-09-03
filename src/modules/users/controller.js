import bcrypt from "bcryptjs"
import prisma from "../../prisma/client.js"
import { createUserSchema, updateUserSchema, changePasswordSchema } from "./validation.js"

export async function listUsers(req, res, next) {
  try {
    const { role, isActive, search, page = 1, limit = 20 } = req.query
    const where = {}
    if (role) where.role = role
    if (isActive !== undefined) where.isActive = isActive === "true"
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ]
    }

    const skip = (Number(page) - 1) * Number(limit)
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, phone: true, role: true,
          avatar: true, isVerified: true, isActive: true,
          lastLoginAt: true, createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.user.count({ where }),
    ])

    res.json({
      success: true,
      data: users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    })
  } catch (err) { next(err) }
}

export async function getUser(req, res, next) {
  try {
    const { id } = req.params
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        avatar: true, isVerified: true, isActive: true,
        lastLoginAt: true, createdAt: true, updatedAt: true,
        customer: true, driver: true,
      },
    })
    if (!user) return res.status(404).json({ success: false, message: "User not found" })
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
}

export async function createUser(req, res, next) {
  try {
    const data = createUserSchema.parse(req.body)
    const existing = await prisma.user.findUnique({ where: { email: data.email } })
    if (existing) return res.status(409).json({ success: false, message: "Email already in use" })

    const hashedPassword = await bcrypt.hash(data.password, 12)
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        password: hashedPassword,
        role: data.role,
        isActive: data.isActive,
      },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        avatar: true, isVerified: true, isActive: true, createdAt: true,
      },
    })
    res.status(201).json({ success: true, data: user, message: "User created successfully" })
  } catch (err) { next(err) }
}

export async function updateUser(req, res, next) {
  try {
    const { id } = req.params
    const data = updateUserSchema.parse(req.body)

    if (data.email) {
      const existing = await prisma.user.findUnique({ where: { email: data.email } })
      if (existing && existing.id !== id) {
        return res.status(409).json({ success: false, message: "Email already in use" })
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        avatar: true, isVerified: true, isActive: true, updatedAt: true,
      },
    })
    res.json({ success: true, data: user, message: "User updated successfully" })
  } catch (err) { next(err) }
}

export async function deleteUser(req, res, next) {
  try {
    const { id } = req.params
    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account" })
    }
    await prisma.user.delete({ where: { id } })
    res.json({ success: true, message: "User deleted successfully" })
  } catch (err) { next(err) }
}

export async function toggleUserActive(req, res, next) {
  try {
    const { id } = req.params
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return res.status(404).json({ success: false, message: "User not found" })
    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: "You cannot deactivate your own account" })
    }
    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    })
    res.json({ success: true, data: updated, message: `User ${updated.isActive ? "activated" : "deactivated"}` })
  } catch (err) { next(err) }
}

export async function changeUserRole(req, res, next) {
  try {
    const { id } = req.params
    const { role } = req.body
    const validRoles = ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "FINANCE", "CUSTOMER_SUPPORT", "WAREHOUSE_MANAGER", "CUSTOMS_OFFICER", "REPORT_VIEWER", "CUSTOMER", "DRIVER"]
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" })
    }
    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, name: true, email: true, role: true },
    })
    res.json({ success: true, data: user, message: "Role updated successfully" })
  } catch (err) { next(err) }
}

export async function changePassword(req, res, next) {
  try {
    const { id } = req.params
    const data = changePasswordSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return res.status(404).json({ success: false, message: "User not found" })

    const valid = await bcrypt.compare(data.currentPassword, user.password)
    if (!valid) return res.status(400).json({ success: false, message: "Current password is incorrect" })

    const hashedPassword = await bcrypt.hash(data.newPassword, 12)
    await prisma.user.update({ where: { id }, data: { password: hashedPassword } })
    res.json({ success: true, message: "Password changed successfully" })
  } catch (err) { next(err) }
}

export async function getUserStats(req, res, next) {
  try {
    const [total, active, byRole] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.groupBy({
        by: ["role"],
        _count: { role: true },
      }),
    ])
    res.json({
      success: true,
      data: {
        total,
        active,
        inactive: total - active,
        byRole: byRole.reduce((acc, r) => ({ ...acc, [r.role]: r._count.role }), {}),
      },
    })
  } catch (err) { next(err) }
}
