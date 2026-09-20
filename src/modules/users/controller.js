import bcrypt from "bcryptjs"
import prisma from "../../prisma/client.js"
import { ASSIGNABLE_ROLES } from "../../utils/roles.js"
import { createUserSchema, updateUserSchema, changePasswordSchema, staffCredentialsSchema } from "./validation.js"

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
          branchId: true, agentKind: true, branch: { select: { id: true, name: true, code: true } },
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

    const branchBound = data.role === "BRANCH_MANAGER" || data.role === "AGENT"
    if (branchBound) {
      const branch = await prisma.branch.findUnique({ where: { id: data.branchId }, select: { isActive: true } })
      if (!branch || !branch.isActive) return res.status(400).json({ success: false, message: "That branch does not exist or is switched off" })
    }

    const hashedPassword = await bcrypt.hash(data.password, 12)
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        password: hashedPassword,
        role: data.role,
        isActive: data.isActive,
        branchId: branchBound ? data.branchId : null,
        agentKind: data.role === "AGENT" ? data.agentKind : null,
      },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        avatar: true, isVerified: true, isActive: true, createdAt: true, branchId: true, agentKind: true,
      },
    })
    res.status(201).json({ success: true, data: user, message: "User created successfully" })
  } catch (err) { next(err) }
}

export async function updateUser(req, res, next) {
  try {
    const { id } = req.params
    const data = updateUserSchema.parse(req.body)

    if (data.role && id === req.user.id && data.role !== req.user.role) {
      return res.status(400).json({ success: false, message: "You cannot change your own role" })
    }

    if (data.email) {
      const existing = await prisma.user.findUnique({ where: { email: data.email } })
      if (existing && existing.id !== id) {
        return res.status(409).json({ success: false, message: "Email already in use" })
      }
    }

    // Keep branch fields consistent with the role: branch roles need a branch (and agents a kind),
    // every other role carries neither.
    const current = await prisma.user.findUnique({ where: { id }, select: { role: true, branchId: true, agentKind: true } })
    if (!current) return res.status(404).json({ success: false, message: "User not found" })
    const nextRole = data.role ?? current.role
    if (nextRole === "BRANCH_MANAGER" || nextRole === "AGENT") {
      const branchId = data.branchId === undefined ? current.branchId : data.branchId
      if (!branchId) return res.status(400).json({ success: false, message: "Choose the branch this person works for" })
      const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { isActive: true } })
      if (!branch || !branch.isActive) return res.status(400).json({ success: false, message: "That branch does not exist or is switched off" })
      const kind = data.agentKind === undefined ? current.agentKind : data.agentKind
      if (nextRole === "AGENT" && !kind) return res.status(400).json({ success: false, message: "Choose the agent's kind of work (clearing, forwarding or receiving)" })
      data.branchId = branchId
      data.agentKind = nextRole === "AGENT" ? kind : null
    } else if (data.role) {
      data.branchId = null
      data.agentKind = null
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        avatar: true, isVerified: true, isActive: true, updatedAt: true, branchId: true, agentKind: true,
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
    if (!ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" })
    }
    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: "You cannot change your own role" })
    }
    // Branch roles need a branch (and agents a kind of work) — set those from Edit user. Any other
    // role carries neither, so moving someone off a branch role clears them.
    const current = await prisma.user.findUnique({ where: { id }, select: { branchId: true, agentKind: true } })
    if (!current) return res.status(404).json({ success: false, message: "User not found" })
    const branchBound = role === "BRANCH_MANAGER" || role === "AGENT"
    if (branchBound && !current.branchId) {
      return res.status(400).json({ success: false, message: "Assign a branch first: open Edit user, choose the branch, then save the role" })
    }
    if (role === "AGENT" && !current.agentKind) {
      return res.status(400).json({ success: false, message: "Choose the agent's kind of work first (Edit user)" })
    }
    const user = await prisma.user.update({
      where: { id },
      data: { role, ...(branchBound ? (role === "AGENT" ? {} : { agentKind: null }) : { branchId: null, agentKind: null }) },
      select: { id: true, name: true, email: true, role: true },
    })
    res.json({ success: true, data: user, message: "Role updated successfully" })
  } catch (err) { next(err) }
}

export async function changePassword(req, res, next) {
  try {
    const { id } = req.params

    // This is a self-service "I know my current password" flow, not an admin reset —
    // it only checks the CURRENT password matches, never who is calling. Without this,
    // anyone who learns another user's current password (e.g. every customer created by
    // an admin starts on the same hardcoded default in customers/controller.js) can call
    // this for that user's id and take the account over.
    if (req.user.id !== id) {
      return res.status(403).json({ success: false, message: "You can only change your own password" })
    }

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

// Admin provisions a staff member's badge code + PIN for shared warehouse scanning
// devices — same hashing convention as the password field.
export async function setStaffCredentials(req, res, next) {
  try {
    const { id } = req.params
    const data = staffCredentialsSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return res.status(404).json({ success: false, message: "User not found" })

    const existingBadge = await prisma.user.findUnique({ where: { badgeCode: data.badgeCode } })
    if (existingBadge && existingBadge.id !== id) {
      return res.status(409).json({ success: false, message: "Badge code already assigned to another user" })
    }

    const hashedPin = await bcrypt.hash(data.pin, 12)
    await prisma.user.update({ where: { id }, data: { badgeCode: data.badgeCode, pinCode: hashedPin } })

    res.json({ success: true, message: "Staff PIN/badge credentials set" })
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
