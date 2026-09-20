// One-off (idempotent): tag shipments booked before branches existed with the branch that handles
// their pickup / delivery city. Shipments whose city has no branch stay untagged.
//   node src/prisma/backfill-shipment-branches.js
import prisma from "./client.js"
import { findBranchForCity } from "../utils/branch-scope.js"

const rows = await prisma.shipment.findMany({
  where: { OR: [{ originBranchId: null }, { destinationBranchId: null }] },
  select: { id: true, originBranchId: true, destinationBranchId: true, fromAddress: { select: { city: true, region: true } }, toAddress: { select: { city: true, region: true } } },
})
let tagged = 0
for (const s of rows) {
  const originBranchId = s.originBranchId ?? (await findBranchForCity(s.fromAddress?.city, s.fromAddress?.region))
  const destinationBranchId = s.destinationBranchId ?? (await findBranchForCity(s.toAddress?.city, s.toAddress?.region))
  if (originBranchId !== s.originBranchId || destinationBranchId !== s.destinationBranchId) {
    await prisma.shipment.update({ where: { id: s.id }, data: { originBranchId, destinationBranchId } })
    tagged++
  }
}
console.log({ checked: rows.length, tagged })
await prisma.$disconnect()
