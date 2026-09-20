// Seeds the first branches. Idempotent (matched by code) and never overwrites edits made since.
//   node src/prisma/seed-branches.js
import bcrypt from "bcryptjs"
import prisma from "./client.js"

const BRANCHES = [
  { code: "DAR", name: "Dar es Salaam (Head Office)", city: "Dar es Salaam", region: "Dar es Salaam", address: "Dar es Salaam", isHeadOffice: true },
  { code: "MWZ", name: "Mwanza Branch", city: "Mwanza", region: "Mwanza", address: "Mwanza" },
  { code: "BUK", name: "Kagera Branch (Bukoba)", city: "Bukoba", region: "Kagera", address: "Bukoba" },
]

async function main() {
  let org = await prisma.organization.findFirst({ where: { name: "Xerin Express" } })
  if (!org) org = await prisma.organization.create({ data: { name: "Xerin Express", email: "info@xerinexpress.co.tz", country: "Tanzania" } })
  for (const b of BRANCHES) {
    await prisma.branch.upsert({ where: { code: b.code }, update: {}, create: { ...b, organizationId: org.id } })
  }

  // Demo staff for trying the branch screens (password DemoPass123!, same as the other demo accounts).
  const hash = await bcrypt.hash("DemoPass123!", 12)
  const mwz = await prisma.branch.findUnique({ where: { code: "MWZ" } })
  const DEMO = [
    { name: "Mwanza Branch Manager", email: "bm.mwanza@demo.xerin", role: "BRANCH_MANAGER" },
    { name: "Mwanza Clearing Agent", email: "agent.mwanza@demo.xerin", role: "AGENT", agentKind: "CLEARING" },
  ]
  for (const u of DEMO) {
    await prisma.user.upsert({
      where: { email: u.email }, update: {},
      create: { ...u, password: hash, isVerified: true, isActive: true, branchId: mwz.id },
    })
  }
  console.log({ branches: await prisma.branch.count() })
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
