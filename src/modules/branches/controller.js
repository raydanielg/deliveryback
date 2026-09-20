import { z } from "zod"
import prisma from "../../prisma/client.js"
import { logAction } from "../../middleware/audit-logger.js"
import { createNotification } from "../notifications/controller.js"
import { AGENT_KINDS, canAccessShipment, userBranchId } from "../../utils/branch-scope.js"

const SUPERUSERS = ["SUPER_ADMIN", "OPERATIONS_MANAGER"]
const isSuper = (u) => SUPERUSERS.includes(u.role)

const branchSchema = z.object({
  name: z.string().min(2).max(80),
  code: z.string().min(2).max(6).regex(/^[A-Za-z0-9]+$/, "Letters and digits only").transform((s) => s.toUpperCase()),
  city: z.string().min(2),
  region: z.string().min(2).optional().nullable(),
  address: z.string().min(2),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  isHeadOffice: z.boolean().default(false),
  isActive: z.boolean().default(true),
})

// Branches belong to an organization; the company itself is the one every branch hangs under.
async function companyOrganization() {
  const existing = await prisma.organization.findFirst({ where: { name: "Xerin Express" } })
  if (existing) return existing
  return prisma.organization.create({ data: { name: "Xerin Express", email: "info@xerinexpress.co.tz", country: "Tanzania" } })
}

// ---------------- branches ----------------

export async function listBranches(req, res, next) {
  try {
    const own = isSuper(req.user) ? null : await userBranchId(req.user)
    if (!isSuper(req.user) && !own) return res.json({ success: true, data: [] })
    const branches = await prisma.branch.findMany({
      where: own ? { id: own } : {},
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
      include: { _count: { select: { staff: true, agentTasks: true, emergencies: true } } },
    })
    res.json({ success: true, data: branches })
  } catch (err) { next(err) }
}

export async function getBranch(req, res, next) {
  try {
    if (!isSuper(req.user) && (await userBranchId(req.user)) !== req.params.id) {
      return res.status(404).json({ success: false, message: "Branch not found" })
    }
    const branch = await prisma.branch.findUnique({
      where: { id: req.params.id },
      include: { staff: { select: { id: true, name: true, email: true, phone: true, role: true, agentKind: true, isActive: true } } },
    })
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" })
    res.json({ success: true, data: branch })
  } catch (err) { next(err) }
}

export async function createBranch(req, res, next) {
  try {
    const data = branchSchema.parse(req.body)
    const org = await companyOrganization()
    const branch = await prisma.branch.create({ data: { ...data, organizationId: org.id } })
    await logAction({ userId: req.user.id, action: "CREATE_BRANCH", entity: "Branch", entityId: branch.id, changes: { code: branch.code, city: branch.city }, req })
    res.status(201).json({ success: true, data: branch })
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ success: false, message: "A branch with that code already exists" })
    next(err)
  }
}

export async function updateBranch(req, res, next) {
  try {
    const data = branchSchema.partial().parse(req.body)
    const branch = await prisma.branch.update({ where: { id: req.params.id }, data })
    await logAction({ userId: req.user.id, action: "UPDATE_BRANCH", entity: "Branch", entityId: branch.id, changes: data, req })
    res.json({ success: true, data: branch })
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ success: false, message: "Branch not found" })
    if (err.code === "P2002") return res.status(409).json({ success: false, message: "A branch with that code already exists" })
    next(err)
  }
}

// Agents a manager can hand work to: their own branch's for a branch manager, all for Super Admin.
export async function listAgents(req, res, next) {
  try {
    const where = { role: "AGENT", isActive: true }
    if (!isSuper(req.user)) {
      const branchId = await userBranchId(req.user)
      if (!branchId) return res.json({ success: true, data: [] })
      where.branchId = branchId
    }
    const data = await prisma.user.findMany({
      where, orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true, agentKind: true, branchId: true, branch: { select: { id: true, name: true, code: true } } },
    })
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

// ---------------- agent tasks ----------------

const taskSchema = z.object({
  shipmentId: z.string().min(1),
  agentId: z.string().min(1),
  kind: z.enum(AGENT_KINDS),
  notes: z.string().max(1000).optional(),
  dueAt: z.string().datetime().optional(),
})

const TASK_LABEL = { CLEARING: "clearing", FORWARDING: "forwarding", RECEIVING: "receiving" }

export async function createTask(req, res, next) {
  try {
    const data = taskSchema.parse(req.body)
    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId }, select: { id: true, trackingNumber: true, status: true } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    const agent = await prisma.user.findUnique({ where: { id: data.agentId }, select: { id: true, name: true, role: true, isActive: true, branchId: true, agentKind: true } })
    if (!agent || agent.role !== "AGENT" || !agent.isActive) return res.status(400).json({ success: false, message: "Choose an active agent" })
    if (!agent.branchId) return res.status(400).json({ success: false, message: "That agent has no branch assigned" })
    if (agent.agentKind !== data.kind) return res.status(400).json({ success: false, message: `That agent does ${agent.agentKind?.toLowerCase() || "no set kind of"} work, not ${TASK_LABEL[data.kind]}` })

    // A branch manager only works inside their own branch: shipment in scope and agent from the same branch.
    if (!isSuper(req.user)) {
      const branchId = await userBranchId(req.user)
      if (!branchId || agent.branchId !== branchId) return res.status(403).json({ success: false, message: "You can only give tasks to agents of your own branch" })
      if (!(await canAccessShipment(req.user, shipment.id))) return res.status(404).json({ success: false, message: "Shipment not found" })
    }

    const task = await prisma.agentTask.create({
      data: {
        shipmentId: shipment.id, branchId: agent.branchId, kind: data.kind, notes: data.notes || null,
        assignedToId: agent.id, assignedById: req.user.id, dueAt: data.dueAt ? new Date(data.dueAt) : null,
      },
    })
    await prisma.trackingEvent.create({
      data: { shipmentId: shipment.id, event: "AGENT_TASK_ASSIGNED", status: shipment.status, description: `${data.kind.toLowerCase()} task assigned to ${agent.name}`, createdBy: req.user.id },
    })
    await createNotification(agent.id, "AGENT_TASK", "New task", `${data.kind} for shipment ${shipment.trackingNumber}${data.notes ? ` — ${data.notes}` : ""}`, { shipmentId: shipment.id }).catch(() => {})
    await logAction({ userId: req.user.id, action: "CREATE_AGENT_TASK", entity: "AgentTask", entityId: task.id, changes: { shipmentId: shipment.id, agentId: agent.id, kind: data.kind }, req })
    res.status(201).json({ success: true, data: task })
  } catch (err) { next(err) }
}

const taskInclude = {
  shipment: { select: { id: true, trackingNumber: true, status: true, toAddress: { select: { fullName: true, phone: true, city: true } }, fromAddress: { select: { city: true } } } },
  assignedTo: { select: { id: true, name: true, agentKind: true } },
  branch: { select: { id: true, name: true, code: true } },
}

export async function listTasks(req, res, next) {
  try {
    const where = {}
    if (req.user.role === "AGENT") where.assignedToId = req.user.id
    else if (!isSuper(req.user)) {
      const branchId = await userBranchId(req.user)
      if (!branchId) return res.json({ success: true, data: [] })
      where.branchId = branchId
    }
    if (req.query.status) where.status = String(req.query.status)
    if (req.query.branchId && isSuper(req.user)) where.branchId = String(req.query.branchId)
    const data = await prisma.agentTask.findMany({ where, include: taskInclude, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 })
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

const taskUpdateSchema = z.object({
  status: z.enum(["IN_PROGRESS", "DONE", "CANCELLED"]),
  resultNotes: z.string().max(1000).optional(),
})

export async function updateTaskStatus(req, res, next) {
  try {
    const data = taskUpdateSchema.parse(req.body)
    const task = await prisma.agentTask.findUnique({ where: { id: req.params.id }, include: { shipment: { select: { trackingNumber: true, status: true } } } })
    if (!task) return res.status(404).json({ success: false, message: "Task not found" })

    const isAssignee = task.assignedToId === req.user.id
    let allowed = false
    if (req.user.role === "AGENT") allowed = isAssignee && data.status !== "CANCELLED"
    else if (isSuper(req.user)) allowed = true
    else if (req.user.role === "BRANCH_MANAGER") allowed = (await userBranchId(req.user)) === task.branchId
    if (!allowed) return res.status(404).json({ success: false, message: "Task not found" })

    if (["DONE", "CANCELLED"].includes(task.status)) return res.status(400).json({ success: false, message: `Task is already ${task.status.toLowerCase()}` })
    if (data.status === "DONE" && !data.resultNotes?.trim()) return res.status(400).json({ success: false, message: "Say what was done (result notes) before completing the task" })

    const updated = await prisma.agentTask.update({
      where: { id: task.id },
      data: { status: data.status, resultNotes: data.resultNotes?.trim() || task.resultNotes, completedAt: data.status === "DONE" ? new Date() : null },
    })
    await prisma.trackingEvent.create({
      data: { shipmentId: task.shipmentId, event: `AGENT_TASK_${data.status}`, status: task.shipment.status, description: `${task.kind.toLowerCase()} task ${data.status.toLowerCase().replace("_", " ")}${data.resultNotes ? `: ${data.resultNotes}` : ""}`, createdBy: req.user.id },
    })
    if (data.status === "DONE" && task.assignedById !== req.user.id) {
      await createNotification(task.assignedById, "AGENT_TASK", "Task completed", `${task.kind} for ${task.shipment.trackingNumber} is done`, { shipmentId: task.shipmentId }).catch(() => {})
    }
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}

// ---------------- emergencies ----------------

const EMERGENCY_TYPES = ["ACCIDENT", "THEFT", "FIRE", "VEHICLE_BREAKDOWN", "CARGO_DAMAGE", "SAFETY_THREAT", "OTHER"]
const emergencySchema = z.object({
  type: z.enum(EMERGENCY_TYPES),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("HIGH"),
  description: z.string().min(5).max(1500),
  location: z.string().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  shipmentId: z.string().optional(),
})

export async function raiseEmergency(req, res, next) {
  try {
    const data = emergencySchema.parse(req.body)
    let branchId = await userBranchId(req.user)
    let shipment = null
    if (data.shipmentId) {
      shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId }, select: { id: true, trackingNumber: true, originBranchId: true, driverId: true } })
      if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })
      // A driver can only report on their own job.
      if (req.user.role === "DRIVER") {
        const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } })
        if (!driver || shipment.driverId !== driver.id) return res.status(404).json({ success: false, message: "Shipment not found" })
      } else if (!(await canAccessShipment(req.user, shipment.id))) {
        return res.status(404).json({ success: false, message: "Shipment not found" })
      }
      branchId = branchId || shipment.originBranchId
    }

    const emergency = await prisma.emergency.create({
      data: { ...data, shipmentId: shipment?.id ?? null, branchId: branchId ?? null, reportedById: req.user.id },
    })

    // Straight to the people who must act: Super Admin / Operations, and the branch manager(s).
    const recipients = await prisma.user.findMany({
      where: { isActive: true, id: { not: req.user.id }, OR: [{ role: { in: SUPERUSERS } }, ...(branchId ? [{ role: "BRANCH_MANAGER", branchId }] : [])] },
      select: { id: true },
    })
    const title = `${data.severity} emergency: ${data.type.replace("_", " ").toLowerCase()}`
    const body = `${data.description}${data.location ? ` (${data.location})` : ""}${shipment ? ` — shipment ${shipment.trackingNumber}` : ""}`
    await Promise.all(recipients.map((r) => createNotification(r.id, "EMERGENCY", title, body, { emergencyId: emergency.id, shipmentId: shipment?.id }).catch(() => {})))

    await logAction({ userId: req.user.id, action: "RAISE_EMERGENCY", entity: "Emergency", entityId: emergency.id, changes: { type: data.type, severity: data.severity }, req })
    res.status(201).json({ success: true, data: emergency, message: `Emergency raised — ${recipients.length} people notified` })
  } catch (err) { next(err) }
}

const emergencyInclude = {
  branch: { select: { id: true, name: true, code: true } },
  shipment: { select: { id: true, trackingNumber: true } },
  reportedBy: { select: { id: true, name: true, role: true } },
}

export async function listEmergencies(req, res, next) {
  try {
    const where = {}
    if (req.query.status) where.status = String(req.query.status)
    if (!isSuper(req.user)) {
      if (req.user.role === "BRANCH_MANAGER") {
        const branchId = await userBranchId(req.user)
        where.OR = [{ reportedById: req.user.id }, ...(branchId ? [{ branchId }] : [])]
      } else {
        where.reportedById = req.user.id
      }
    }
    const data = await prisma.emergency.findMany({ where, include: emergencyInclude, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 })
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

const emergencyUpdateSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "RESOLVED"]),
  resolution: z.string().max(1500).optional(),
})

export async function updateEmergency(req, res, next) {
  try {
    const data = emergencyUpdateSchema.parse(req.body)
    const e = await prisma.emergency.findUnique({ where: { id: req.params.id } })
    if (!e) return res.status(404).json({ success: false, message: "Emergency not found" })
    if (!isSuper(req.user) && (!e.branchId || (await userBranchId(req.user)) !== e.branchId)) return res.status(404).json({ success: false, message: "Emergency not found" })
    if (e.status === "RESOLVED") return res.status(400).json({ success: false, message: "Already resolved" })
    if (data.status === "RESOLVED" && !data.resolution?.trim()) return res.status(400).json({ success: false, message: "Describe how it was resolved" })

    const updated = await prisma.emergency.update({
      where: { id: e.id },
      data: data.status === "ACKNOWLEDGED"
        ? { status: "ACKNOWLEDGED", acknowledgedAt: e.acknowledgedAt ?? new Date() }
        : { status: "RESOLVED", resolution: data.resolution.trim(), resolvedById: req.user.id, resolvedAt: new Date() },
    })
    if (e.reportedById !== req.user.id) {
      await createNotification(e.reportedById, "EMERGENCY", `Your emergency was ${data.status.toLowerCase()}`, data.resolution || "The team has seen your report.", { emergencyId: e.id }).catch(() => {})
    }
    await logAction({ userId: req.user.id, action: `EMERGENCY_${data.status}`, entity: "Emergency", entityId: e.id, changes: data, req })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}
