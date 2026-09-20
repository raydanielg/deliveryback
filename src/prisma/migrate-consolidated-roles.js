// One-off, idempotent: moves every user on a retired role onto the role that inherited
// its duties (see LEGACY_ROLE_MAP in src/utils/roles.js). Run BEFORE removing the retired
// values from the UserRole enum, since Postgres refuses to drop enum values still in use.
//
//   node src/prisma/migrate-consolidated-roles.js
import prisma from "./client.js"
import { LEGACY_ROLE_MAP } from "../utils/roles.js"

async function main() {
  const before = await prisma.user.groupBy({ by: ["role"], _count: { role: true } })
  console.log("Before:", Object.fromEntries(before.map((r) => [r.role, r._count.role])))

  for (const [legacy, target] of Object.entries(LEGACY_ROLE_MAP)) {
    const res = await prisma.$executeRawUnsafe(
      `UPDATE "users" SET "role" = '${target}'::"UserRole" WHERE "role"::text = '${legacy}'`
    )
    if (res > 0) console.log(`  ${legacy} -> ${target}: ${res} user(s)`)
  }

  const after = await prisma.user.groupBy({ by: ["role"], _count: { role: true } })
  console.log("After: ", Object.fromEntries(after.map((r) => [r.role, r._count.role])))
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
