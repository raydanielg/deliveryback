import prisma from "../../prisma/client.js"
import { addressSchema, updateAddressSchema } from "./validation.js"

// The Address book is keyed off the Customer profile, not the User directly — but nothing
// in the codebase ever actually creates that Customer row for a CUSTOMER-role user (it's
// only ever referenced, never written). Get-or-create it here so saving an address works
// on the very first call instead of silently failing on a missing foreign key.
async function getOrCreateCustomerProfile(userId, phone) {
  const existing = await prisma.customer.findUnique({ where: { userId } })
  if (existing) return existing
  const user = await prisma.user.findUnique({ where: { id: userId } })
  return prisma.customer.create({
    data: { userId, phone: phone || user?.phone || "" },
  })
}

export async function listMyAddresses(req, res, next) {
  try {
    const customer = await prisma.customer.findUnique({ where: { userId: req.user.id } })
    if (!customer) return res.json({ success: true, data: [] })

    const addresses = await prisma.address.findMany({
      where: { customerId: customer.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    })
    res.json({ success: true, data: addresses })
  } catch (err) { next(err) }
}

export async function getAddress(req, res, next) {
  try {
    const { id } = req.params
    const customer = await prisma.customer.findUnique({ where: { userId: req.user.id } })
    const address = await prisma.address.findUnique({ where: { id } })
    if (!address || !customer || address.customerId !== customer.id) {
      return res.status(404).json({ success: false, message: "Address not found" })
    }
    res.json({ success: true, data: address })
  } catch (err) { next(err) }
}

export async function createAddress(req, res, next) {
  try {
    const data = addressSchema.parse(req.body)
    const customer = await getOrCreateCustomerProfile(req.user.id, data.phone)

    const address = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({ where: { customerId: customer.id, isDefault: true }, data: { isDefault: false } })
      }
      const existingCount = await tx.address.count({ where: { customerId: customer.id } })
      return tx.address.create({
        data: { ...data, customerId: customer.id, isDefault: data.isDefault ?? existingCount === 0 },
      })
    })

    res.status(201).json({ success: true, data: address, message: "Address saved" })
  } catch (err) { next(err) }
}

export async function updateAddress(req, res, next) {
  try {
    const { id } = req.params
    const data = updateAddressSchema.parse(req.body)

    const customer = await prisma.customer.findUnique({ where: { userId: req.user.id } })
    const existing = await prisma.address.findUnique({ where: { id } })
    if (!existing || !customer || existing.customerId !== customer.id) {
      return res.status(404).json({ success: false, message: "Address not found" })
    }

    const address = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({ where: { customerId: customer.id, isDefault: true, id: { not: id } }, data: { isDefault: false } })
      }
      return tx.address.update({ where: { id }, data })
    })

    res.json({ success: true, data: address, message: "Address updated" })
  } catch (err) { next(err) }
}

export async function deleteAddress(req, res, next) {
  try {
    const { id } = req.params
    const customer = await prisma.customer.findUnique({ where: { userId: req.user.id } })
    const existing = await prisma.address.findUnique({ where: { id } })
    if (!existing || !customer || existing.customerId !== customer.id) {
      return res.status(404).json({ success: false, message: "Address not found" })
    }

    const inUse = await prisma.shipment.findFirst({
      where: { OR: [{ fromAddressId: id }, { toAddressId: id }] },
      select: { id: true },
    })
    if (inUse) {
      return res.status(400).json({ success: false, message: "This address is used by an existing shipment and cannot be deleted" })
    }

    await prisma.address.delete({ where: { id } })
    res.json({ success: true, message: "Address deleted" })
  } catch (err) { next(err) }
}
