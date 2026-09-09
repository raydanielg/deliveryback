import prisma from "../../prisma/client.js"
import fs from "fs/promises"
import path from "path"
import { createClaimSchema, updateClaimStatusSchema, assignClaimSchema } from "./validation.js"
import { createNotification } from "../notifications/controller.js"

function generateClaimNumber() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  return `CLM-${year}-${random}`
}

// OPEN -> UNDER_REVIEW -> INVESTIGATION -> APPROVED / REJECTED -> RESOLUTION -> CLOSED
// Mirrors the workflow the platform brief specifies; anything not listed here is rejected
// so a claim can't be silently skipped from e.g. OPEN straight to CLOSED.
const VALID_TRANSITIONS = {
  OPEN: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["INVESTIGATION", "APPROVED", "REJECTED"],
  INVESTIGATION: ["APPROVED", "REJECTED"],
  APPROVED: ["RESOLUTION"],
  REJECTED: ["CLOSED"],
  RESOLUTION: ["CLOSED"],
  CLOSED: [],
}

const CLAIM_SUMMARY_INCLUDE = {
  shipment: {
    select: { id: true, trackingNumber: true, status: true, totalAmount: true, currency: true },
  },
  customer: { select: { id: true, name: true, email: true, phone: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  resolvedBy: { select: { id: true, name: true } },
}

export async function listClaims(req, res, next) {
  try {
    const { status, type, shipmentId, page = 1, limit = 50 } = req.query
    const where = {}
    if (status) where.status = status
    if (type) where.type = type
    if (shipmentId) where.shipmentId = shipmentId
    // Customers only ever see their own claims — staff (anyone with claims.view via a
    // non-CUSTOMER role) see everything, filtered by the query params above.
    if (req.user?.role === "CUSTOMER") where.customerId = req.user.id

    const [claims, total] = await Promise.all([
      prisma.claim.findMany({
        where,
        include: CLAIM_SUMMARY_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: Number(limit),
        skip: (Number(page) - 1) * Number(limit),
      }),
      prisma.claim.count({ where }),
    ])

    res.json({ success: true, data: claims, meta: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) } })
  } catch (err) { next(err) }
}

export async function getClaim(req, res, next) {
  try {
    const { id } = req.params
    const claim = await prisma.claim.findUnique({
      where: { id },
      include: CLAIM_SUMMARY_INCLUDE,
    })
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" })
    if (req.user?.role === "CUSTOMER" && claim.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: "You do not have access to this claim" })
    }
    res.json({ success: true, data: claim })
  } catch (err) { next(err) }
}

export async function createClaim(req, res, next) {
  try {
    const data = createClaimSchema.parse(req.body)

    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } })
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" })

    // A customer can only claim against their own shipment; staff filing on a customer's
    // behalf (e.g. from a support call) can target any shipment.
    if (req.user.role === "CUSTOMER" && shipment.createdById !== req.user.id) {
      return res.status(403).json({ success: false, message: "You can only file claims for your own shipments" })
    }

    const evidenceUrls = [...(data.evidenceUrls || [])]
    if (req.files?.length) {
      const uploadsDir = path.join(process.cwd(), "uploads", "claims")
      await fs.mkdir(uploadsDir, { recursive: true })
      for (const file of req.files) {
        const ext = file.originalname.split(".").pop() || "jpg"
        const filename = `claim-${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`
        await fs.writeFile(path.join(uploadsDir, filename), file.buffer)
        evidenceUrls.push(`/uploads/claims/${filename}`)
      }
    }

    const claim = await prisma.claim.create({
      data: {
        claimNumber: generateClaimNumber(),
        shipmentId: data.shipmentId,
        customerId: req.user.role === "CUSTOMER" ? req.user.id : shipment.createdById,
        type: data.type,
        description: data.description,
        claimedAmount: data.claimedAmount,
        evidenceUrls,
      },
      include: CLAIM_SUMMARY_INCLUDE,
    })

    try {
      await createNotification(
        claim.customerId,
        "CLAIM_CREATED",
        "Claim Submitted",
        `Your claim ${claim.claimNumber} for shipment ${shipment.trackingNumber} has been received and is under review.`,
        { claimId: claim.id, claimNumber: claim.claimNumber }
      )
    } catch (notifErr) {
      console.warn("Claim notification failed:", notifErr.message)
    }

    res.status(201).json({ success: true, data: claim, message: "Claim submitted successfully" })
  } catch (err) { next(err) }
}

export async function updateClaimStatus(req, res, next) {
  try {
    const { id } = req.params
    const data = updateClaimStatusSchema.parse(req.body)

    const claim = await prisma.claim.findUnique({ where: { id } })
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" })

    const allowedNext = VALID_TRANSITIONS[claim.status] || []
    if (claim.status !== data.status && !allowedNext.includes(data.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot move claim from ${claim.status} to ${data.status}`,
      })
    }

    const updateData = { status: data.status }
    if (data.resolution !== undefined) updateData.resolution = data.resolution
    if (data.resolvedAmount !== undefined) updateData.resolvedAmount = data.resolvedAmount
    if (["RESOLUTION", "CLOSED", "REJECTED"].includes(data.status) && !claim.resolvedAt) {
      updateData.resolvedAt = new Date()
      updateData.resolvedById = req.user.id
    }

    const updated = await prisma.claim.update({
      where: { id },
      data: updateData,
      include: CLAIM_SUMMARY_INCLUDE,
    })

    try {
      await createNotification(
        claim.customerId,
        "CLAIM_UPDATED",
        "Claim Status Updated",
        `Your claim ${claim.claimNumber} is now ${data.status.replace(/_/g, " ").toLowerCase()}.`,
        { claimId: claim.id, claimNumber: claim.claimNumber, status: data.status }
      )
    } catch (notifErr) {
      console.warn("Claim notification failed:", notifErr.message)
    }

    res.json({ success: true, data: updated, message: "Claim updated" })
  } catch (err) { next(err) }
}

export async function assignClaim(req, res, next) {
  try {
    const { id } = req.params
    const data = assignClaimSchema.parse(req.body)

    const claim = await prisma.claim.findUnique({ where: { id } })
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" })

    const assignee = await prisma.user.findUnique({ where: { id: data.assignedToId } })
    if (!assignee) return res.status(404).json({ success: false, message: "Assignee not found" })

    const updated = await prisma.claim.update({
      where: { id },
      data: { assignedToId: data.assignedToId },
      include: CLAIM_SUMMARY_INCLUDE,
    })

    res.json({ success: true, data: updated, message: "Claim assigned" })
  } catch (err) { next(err) }
}

export async function getClaimStats(req, res, next) {
  try {
    const [byStatus, byType, total, open, closed] = await Promise.all([
      prisma.claim.groupBy({ by: ["status"], _count: { status: true } }),
      prisma.claim.groupBy({ by: ["type"], _count: { type: true } }),
      prisma.claim.count(),
      prisma.claim.count({ where: { status: { notIn: ["CLOSED", "REJECTED"] } } }),
      prisma.claim.count({ where: { status: "CLOSED" } }),
    ])
    res.json({ success: true, data: { total, open, closed, byStatus, byType } })
  } catch (err) { next(err) }
}
