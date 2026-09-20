#!/usr/bin/env node
/**
 * XERIN Terminal Admin Console
 * ----------------------------
 * A dependency-free super-admin CLI. Run with:  npm run admin
 *
 * Commands:
 *   monitor                 Live request table (tails logs/requests.log)
 *   users [filter]          List all users (optionally filter by text)
 *   user <email>            Show one user's full detail
 *   role <email> <ROLE>     Change a user's role
 *   reset <email>           Reset a user's password to DemoPass123!
 *   verify <email>          Mark a user verified
 *   activate <email>        Enable a user account
 *   deactivate <email>      Disable a user account
 *   stats                   Counts of users, shipments, orders, invoices
 *   audit [n]               Show the last n audit-log entries (default 15)
 *   roles                   List every role and how many users have it
 *   clear                   Clear the screen
 *   help                    Show this menu
 *   exit                    Quit
 */
import "dotenv/config"
import fs from "node:fs"
import readline from "node:readline"
import prisma from "../prisma/client.js"
import { REQUEST_LOG_FILE } from "../lib/request-log.js"

const DEMO_PASSWORD = "DemoPass123!"

// ---------- formatting helpers ----------
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
}
const paint = (color, s) => `${C[color]}${s}${C.reset}`
const pad = (s, n) => {
  s = String(s ?? "")
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n)
}
const statusColor = (code) =>
  code >= 500 ? "red" : code >= 400 ? "yellow" : code >= 300 ? "cyan" : "green"

function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length))
  )
  const line = (cells) =>
    cells.map((c, i) => pad(c, widths[i])).join("  ").trimEnd()
  const sep = widths.map((w) => "─".repeat(w)).join("──")
  return [
    paint("bold", line(headers)),
    paint("gray", sep),
    ...rows.map((r) => line(r)),
  ].join("\n")
}

// ---------- commands ----------
async function cmdUsers(filter) {
  const where = filter
    ? {
        OR: [
          { name: { contains: filter, mode: "insensitive" } },
          { email: { contains: filter, mode: "insensitive" } },
          { role: { contains: filter, mode: "insensitive" } },
        ],
      }
    : {}
  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      name: true, email: true, role: true, phone: true,
      isVerified: true, isActive: true, createdAt: true,
    },
  })
  if (!users.length) return console.log(paint("yellow", "No users found."))
  console.log(
    table(
      ["NAME", "EMAIL", "ROLE", "PHONE", "VERIFIED", "ACTIVE", "CREATED"],
      users.map((u) => [
        u.name, u.email, u.role, u.phone || "-",
        u.isVerified ? "yes" : "no",
        u.isActive ? "yes" : paint("red", "no"),
        u.createdAt.toISOString().slice(0, 10),
      ])
    )
  )
  console.log(paint("dim", `\n${users.length} user(s)`))
}

async function cmdUser(email) {
  const u = await prisma.user.findUnique({
    where: { email },
    include: { customer: true, driver: true },
  })
  if (!u) return console.log(paint("red", `No user with email ${email}`))
  console.log(paint("bold", `\n${u.name} <${u.email}>`))
  for (const [k, v] of Object.entries({
    id: u.id, role: u.role, phone: u.phone, verified: u.isVerified,
    active: u.isActive, lastLogin: u.lastLoginAt, created: u.createdAt,
    customerId: u.customer?.id, customerCode: u.customer?.customerCode,
    driverId: u.driver?.id, driverStatus: u.driver?.status,
  })) {
    if (v !== undefined && v !== null) console.log(`  ${pad(k, 14)} ${v}`)
  }
}

async function findUser(email) {
  const u = await prisma.user.findUnique({ where: { email } })
  if (!u) console.log(paint("red", `No user with email ${email}`))
  return u
}

async function cmdRole(email, role) {
  const u = await findUser(email)
  if (!u) return
  const valid = await prisma.$queryRawUnsafe(
    `SELECT unnest(enum_range(NULL::"UserRole"))::text AS r`
  )
  const roles = valid.map((r) => r.r)
  if (!roles.includes(role)) {
    return console.log(paint("red", `Invalid role. Valid: ${roles.join(", ")}`))
  }
  await prisma.user.update({ where: { email }, data: { role } })
  console.log(paint("green", `✔ ${email} role -> ${role}`))
}

async function cmdReset(email) {
  const u = await findUser(email)
  if (!u) return
  const bcrypt = await import("bcryptjs")
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12)
  await prisma.user.update({ where: { email }, data: { password: hash } })
  console.log(paint("green", `✔ ${email} password reset to ${DEMO_PASSWORD}`))
}

async function cmdFlag(email, field, value, label) {
  const u = await findUser(email)
  if (!u) return
  await prisma.user.update({ where: { email }, data: { [field]: value } })
  console.log(paint("green", `✔ ${email} ${label}`))
}

async function cmdStats() {
  const [users, customers, shipments, orders, invoices, deliveries, boxes, trips] =
    await Promise.all([
      prisma.user.count(),
      prisma.customer.count(),
      prisma.shipment.count(),
      prisma.order.count(),
      prisma.invoice.count().catch(() => 0),
      prisma.deliveryRecord.count().catch(() => 0),
      prisma.consolidationBox.count().catch(() => 0),
      prisma.tripManifest.count().catch(() => 0),
    ])
  console.log(
    table(
      ["ENTITY", "COUNT"],
      [
        ["Users", users], ["Customers", customers], ["Shipments", shipments],
        ["Orders", orders], ["Invoices", invoices], ["Delivery Records", deliveries],
        ["Consolidation Boxes", boxes], ["Trip Manifests", trips],
      ]
    )
  )
}

async function cmdRoles() {
  const grouped = await prisma.user.groupBy({ by: ["role"], _count: { role: true } })
  console.log(
    table(
      ["ROLE", "USERS"],
      grouped
        .sort((a, b) => b._count.role - a._count.role)
        .map((g) => [g.role, g._count.role])
    )
  )
}

async function cmdAudit(n = 15) {
  const logs = await prisma.auditLog.findMany({
    take: Number(n) || 15,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true, role: true } } },
  })
  if (!logs.length) return console.log(paint("yellow", "No audit logs yet."))
  console.log(
    table(
      ["TIME", "USER", "ACTION", "ENTITY", "ENTITY_ID"],
      logs.map((l) => [
        l.createdAt.toISOString().replace("T", " ").slice(0, 19),
        l.user?.email || "system",
        l.action, l.entity, (l.entityId || "-").slice(0, 12),
      ])
    )
  )
}

const money = (n, cur = "TZS") =>
  `${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${cur}`
const ago = (d) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "-")

async function cmdDash() {
  const [
    users, customers, shipments, orders, invoices, payments,
    activeUsers, paidInvoices, recentUsers, recentShipments, recentAudit,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.customer.count(),
    prisma.shipment.count(),
    prisma.order.count(),
    prisma.invoice.count().catch(() => 0),
    prisma.payment.count().catch(() => 0),
    prisma.user.count({ where: { isActive: true } }),
    prisma.invoice.findMany({ where: { status: "PAID" }, select: { total: true, currency: true } }).catch(() => []),
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { name: true, email: true, role: true, createdAt: true } }),
    prisma.shipment.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { trackingNumber: true, status: true, totalAmount: true, currency: true, createdAt: true } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { user: { select: { email: true } } } }),
  ])
  const revenue = paidInvoices.reduce((s, i) => s + Number(i.total), 0)

  console.log(paint("magenta", paint("bold", "\n◆ XERIN Overview ◆")))
  console.log(table(["METRIC", "VALUE"], [
    ["Users (active)", `${users} (${activeUsers})`],
    ["Customers", customers],
    ["Shipments", shipments],
    ["Orders", orders],
    ["Invoices", invoices],
    ["Payments", payments],
    ["Revenue (paid invoices)", paint("green", money(revenue))],
  ]))

  console.log(paint("bold", "\nLatest users"))
  console.log(table(["NAME", "EMAIL", "ROLE", "JOINED"],
    recentUsers.map((u) => [u.name, u.email, u.role, ago(u.createdAt)])))

  console.log(paint("bold", "\nLatest shipments"))
  console.log(table(["TRACKING", "STATUS", "AMOUNT", "CREATED"],
    recentShipments.map((s) => [s.trackingNumber, s.status, money(s.totalAmount, s.currency), ago(s.createdAt)])))

  console.log(paint("bold", "\nRecent activity"))
  console.log(table(["TIME", "USER", "ACTION", "ENTITY"],
    recentAudit.map((l) => [ago(l.createdAt), l.user?.email || "system", l.action, l.entity])))
}

async function cmdShipments(n = 15) {
  const rows = await prisma.shipment.findMany({
    take: Number(n) || 15,
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { customerCode: true, user: { select: { name: true } } } } },
  })
  if (!rows.length) return console.log(paint("yellow", "No shipments."))
  console.log(table(["TRACKING", "STATUS", "PAY", "KG", "AMOUNT", "CUSTOMER", "CREATED"],
    rows.map((s) => [
      s.trackingNumber, s.status, s.paymentStatus,
      Number(s.actualWeightKg), money(s.totalAmount, s.currency),
      s.customer?.user?.name || s.customer?.customerCode || "-", ago(s.createdAt),
    ])))
}

async function cmdOrders(n = 15) {
  const rows = await prisma.order.findMany({
    take: Number(n) || 15,
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { customerCode: true, user: { select: { name: true } } } } },
  })
  if (!rows.length) return console.log(paint("yellow", "No orders."))
  console.log(table(["ORDER", "STATUS", "PAYMENT", "TOTAL", "CUSTOMER", "CREATED"],
    rows.map((o) => [
      o.orderNumber, o.status, o.paymentStatus, money(o.totalAmount, o.currency),
      o.customer?.user?.name || o.customer?.customerCode || "-", ago(o.createdAt),
    ])))
}

async function cmdInvoices(n = 15) {
  const rows = await prisma.invoice.findMany({
    take: Number(n) || 15,
    orderBy: { createdAt: "desc" },
    include: { shipment: { select: { trackingNumber: true } } },
  }).catch(() => [])
  if (!rows.length) return console.log(paint("yellow", "No invoices."))
  console.log(table(["INVOICE", "STATUS", "TOTAL", "METHOD", "SHIPMENT", "CREATED"],
    rows.map((i) => [
      i.invoiceNumber, i.status === "PAID" ? paint("green", i.status) : i.status,
      money(i.total, i.currency), i.paymentMethod || "-",
      i.shipment?.trackingNumber || "-", ago(i.createdAt),
    ])))
}

async function cmdPayments(n = 15) {
  const rows = await prisma.payment.findMany({
    take: Number(n) || 15,
    orderBy: { createdAt: "desc" },
    include: { order: { select: { orderNumber: true } }, payer: { select: { email: true } } },
  }).catch(() => [])
  if (!rows.length) return console.log(paint("yellow", "No payments."))
  console.log(table(["REF", "STATUS", "AMOUNT", "METHOD", "ORDER", "PAYER", "DATE"],
    rows.map((p) => [
      p.paymentRef, p.status, money(p.amount, p.currency), p.method,
      p.order?.orderNumber || "-", p.payer?.email || "-", ago(p.paidAt || p.createdAt),
    ])))
}

async function cmdRevenue() {
  const [inv, pay] = await Promise.all([
    prisma.invoice.groupBy({ by: ["status"], _sum: { total: true }, _count: true }).catch(() => []),
    prisma.payment.groupBy({ by: ["status"], _sum: { amount: true }, _count: true }).catch(() => []),
  ])
  console.log(paint("bold", "\nInvoices by status"))
  console.log(table(["STATUS", "COUNT", "TOTAL"],
    inv.map((g) => [g.status, g._count, money(g._sum.total)])))
  console.log(paint("bold", "\nPayments by status"))
  console.log(table(["STATUS", "COUNT", "TOTAL"],
    pay.map((g) => [g.status, g._count, money(g._sum.amount)])))
}

async function cmdOnline() {
  const rows = await prisma.user.findMany({
    where: { lastLoginAt: { not: null } },
    orderBy: { lastLoginAt: "desc" },
    take: 15,
    select: { name: true, email: true, role: true, lastLoginAt: true, isActive: true },
  })
  if (!rows.length) return console.log(paint("yellow", "No logins recorded yet."))
  console.log(table(["NAME", "EMAIL", "ROLE", "ACTIVE", "LAST LOGIN"],
    rows.map((u) => [u.name, u.email, u.role, u.isActive ? "yes" : paint("red", "no"), ago(u.lastLoginAt)])))
}

async function cmdTrack(tn) {
  if (!tn) return console.log(paint("yellow", "Usage: track <trackingNumber>"))
  const s = await prisma.shipment.findUnique({
    where: { trackingNumber: tn },
    include: {
      customer: { select: { customerCode: true, user: { select: { name: true, email: true } } } },
      trackingEvents: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  })
  if (!s) return console.log(paint("red", `No shipment ${tn}`))
  console.log(paint("bold", `\n${s.trackingNumber}`))
  for (const [k, v] of Object.entries({
    status: s.status, payment: s.paymentStatus, category: s.category,
    weight: `${s.actualWeightKg} kg`, amount: money(s.totalAmount, s.currency),
    customer: s.customer?.user?.name || s.customer?.customerCode || "-",
    created: ago(s.createdAt), estDelivery: ago(s.estimatedDelivery),
  })) console.log(`  ${pad(k, 12)} ${v}`)
  if (s.trackingEvents.length) {
    console.log(paint("bold", "\n  Tracking events"))
    console.log(table(["TIME", "STATUS", "NOTE"],
      s.trackingEvents.map((e) => [ago(e.createdAt), e.status, (e.description || e.note || "-").slice(0, 40)])))
  }
}

async function cmdFind(text) {
  if (!text) return console.log(paint("yellow", "Usage: find <text>"))
  const [users, ships, customers] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ name: { contains: text, mode: "insensitive" } }, { email: { contains: text, mode: "insensitive" } }] },
      take: 8, select: { name: true, email: true, role: true },
    }),
    prisma.shipment.findMany({
      where: { trackingNumber: { contains: text, mode: "insensitive" } },
      take: 8, select: { trackingNumber: true, status: true },
    }),
    prisma.customer.findMany({
      where: { customerCode: { contains: text, mode: "insensitive" } },
      take: 8, select: { customerCode: true, user: { select: { name: true } } },
    }),
  ])
  if (users.length) {
    console.log(paint("bold", "\nUsers"))
    console.log(table(["NAME", "EMAIL", "ROLE"], users.map((u) => [u.name, u.email, u.role])))
  }
  if (ships.length) {
    console.log(paint("bold", "\nShipments"))
    console.log(table(["TRACKING", "STATUS"], ships.map((s) => [s.trackingNumber, s.status])))
  }
  if (customers.length) {
    console.log(paint("bold", "\nCustomers"))
    console.log(table(["CODE", "NAME"], customers.map((c) => [c.customerCode, c.user?.name || "-"])))
  }
  if (!users.length && !ships.length && !customers.length)
    console.log(paint("yellow", `Nothing matches "${text}".`))
}

async function cmdCreate(email, name, role) {
  if (!email || !name || !role)
    return console.log(paint("yellow", "Usage: create <email> <name> <ROLE>"))
  const exists = await prisma.user.findUnique({ where: { email } })
  if (exists) return console.log(paint("red", `${email} already exists`))
  const bcrypt = await import("bcryptjs")
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12)
  const u = await prisma.user.create({
    data: { email, name, role, password: hash, isVerified: true },
  })
  console.log(paint("green", `✔ Created ${u.email} (${u.role}) — password ${DEMO_PASSWORD}`))
}

async function cmdDelete(email, confirm) {
  if (!email) return console.log(paint("yellow", "Usage: delete <email> --confirm"))
  const u = await prisma.user.findUnique({ where: { email } })
  if (!u) return console.log(paint("red", `No user ${email}`))
  if (confirm !== "--confirm")
    return console.log(paint("yellow", `Re-run with --confirm to permanently delete ${email} (${u.role})`))
  await prisma.user.delete({ where: { email } })
  console.log(paint("green", `✔ Deleted ${email}`))
}

async function cmdHealth() {
  const t0 = Date.now()
  await prisma.$queryRawUnsafe("SELECT 1")
  const dbMs = Date.now() - t0
  console.log(table(["CHECK", "RESULT"], [
    ["Database", paint("green", `connected (${dbMs}ms)`)],
    ["DATABASE_URL", process.env.DATABASE_URL ? "set" : paint("red", "missing")],
    ["Request log", fs.existsSync(REQUEST_LOG_FILE) ? `${REQUEST_LOG_FILE}` : "not created yet"],
    ["Node", process.version],
    ["Time", new Date().toISOString()],
  ]))
}

// ---------- live request monitor ----------
function monitor() {
  console.log(paint("cyan", "\nLive request monitor — Ctrl+C to return to menu\n"))
  console.log(
    paint("bold", `${pad("TIME", 9)} ${pad("METHOD", 7)} ${pad("STATUS", 6)} ${pad("MS", 6)} URL`)
  )
  let offset = 0
  try { offset = fs.statSync(REQUEST_LOG_FILE).size } catch { offset = 0 }

  const timer = setInterval(() => {
    let size = 0
    try { size = fs.statSync(REQUEST_LOG_FILE).size } catch { return }
    if (size < offset) offset = 0 // file was rotated/truncated
    if (size === offset) return
    const fd = fs.openSync(REQUEST_LOG_FILE, "r")
    const buf = Buffer.alloc(size - offset)
    fs.readSync(fd, buf, 0, size - offset, offset)
    fs.closeSync(fd)
    offset = size
    buf.toString("utf8").split("\n").forEach((line) => {
      if (!line.trim()) return
      try {
        const e = JSON.parse(line)
        const time = e.ts.slice(11, 19)
        const status = paint(statusColor(e.status), pad(e.status, 6))
        console.log(
          `${paint("dim", time)} ${pad(e.method, 7)} ${status} ${pad(e.ms, 6)} ${e.url}`
        )
      } catch { /* skip malformed line */ }
    })
  }, 700)

  return new Promise((resolve) => {
    process.once("SIGINT", () => {
      clearInterval(timer)
      console.log(paint("dim", "\n(monitor stopped)"))
      resolve()
    })
  })
}

// ---------- REPL ----------
const HELP = `
${paint("bold", "XERIN Admin Console — commands")}
  ${paint("magenta", "OVERVIEW")}
  ${paint("cyan", "dash")}                    full dashboard: counts, revenue, latest users/shipments/activity
  ${paint("cyan", "monitor")}                 live request table (tails logs/requests.log)
  ${paint("cyan", "health")}                  DB ping + environment check
  ${paint("cyan", "stats")}                   entity counts
  ${paint("cyan", "revenue")}                 invoice & payment totals by status
  ${paint("magenta", "OPERATIONS")}
  ${paint("cyan", "shipments")} [n]           latest shipments
  ${paint("cyan", "orders")} [n]              latest orders
  ${paint("cyan", "invoices")} [n]            latest invoices
  ${paint("cyan", "payments")} [n]            latest payments
  ${paint("cyan", "track")} <trackingNo>      shipment detail + tracking events
  ${paint("cyan", "find")} <text>             search users, shipments, customers
  ${paint("cyan", "audit")} [n]               last n audit entries
  ${paint("magenta", "USERS")}
  ${paint("cyan", "users")} [filter]          list all users
  ${paint("cyan", "user")} <email>            user detail
  ${paint("cyan", "online")}                  most recent logins
  ${paint("cyan", "roles")}                   users per role
  ${paint("cyan", "create")} <email> <name> <ROLE>   new user (pw ${DEMO_PASSWORD})
  ${paint("cyan", "role")} <email> <ROLE>     change role
  ${paint("cyan", "reset")} <email>           reset password -> ${DEMO_PASSWORD}
  ${paint("cyan", "verify")} / ${paint("cyan", "activate")} / ${paint("cyan", "deactivate")} <email>
  ${paint("cyan", "delete")} <email> --confirm   permanently delete user
  ${paint("cyan", "clear")} / ${paint("cyan", "help")} / ${paint("cyan", "exit")}
`

async function handle(line) {
  const [cmd, ...args] = line.trim().split(/\s+/)
  switch ((cmd || "").toLowerCase()) {
    case "": break
    case "help": console.log(HELP); break
    case "clear": console.clear(); break
    case "monitor": case "mon": await monitor(); break
    case "dash": case "dashboard": case "overview": await cmdDash(); break
    case "users": await cmdUsers(args[0]); break
    case "user": await cmdUser(args[0]); break
    case "role": await cmdRole(args[0], args[1]); break
    case "reset": await cmdReset(args[0]); break
    case "verify": await cmdFlag(args[0], "isVerified", true, "verified"); break
    case "activate": await cmdFlag(args[0], "isActive", true, "activated"); break
    case "deactivate": await cmdFlag(args[0], "isActive", false, "deactivated"); break
    case "create": await cmdCreate(args[0], args[1], args[2]); break
    case "delete": case "del": await cmdDelete(args[0], args[1]); break
    case "stats": await cmdStats(); break
    case "roles": await cmdRoles(); break
    case "audit": await cmdAudit(args[0]); break
    case "shipments": case "ship": await cmdShipments(args[0]); break
    case "orders": await cmdOrders(args[0]); break
    case "invoices": case "inv": await cmdInvoices(args[0]); break
    case "payments": case "pay": await cmdPayments(args[0]); break
    case "revenue": case "rev": await cmdRevenue(); break
    case "online": await cmdOnline(); break
    case "track": await cmdTrack(args[0]); break
    case "find": case "search": await cmdFind(args.slice(0).join(" ")); break
    case "health": await cmdHealth(); break
    case "exit": case "quit": case "q": return false
    default: console.log(paint("yellow", `Unknown command "${cmd}". Type help.`))
  }
  return true
}

async function main() {
  console.log(paint("magenta", paint("bold", "\n◆ XERIN Terminal Admin Console ◆")))
  console.log(paint("dim", `DB: ${process.env.DATABASE_URL ? "connected" : "no DATABASE_URL"}  |  type "help"`))
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: paint("green", "xerin> "),
  })
  let alive = true
  let queue = Promise.resolve()
  rl.on("line", (line) => {
    // Serialize commands so async handlers never overlap and prompt() is only
    // called while the interface is still open.
    queue = queue.then(async () => {
      if (!alive) return
      try {
        const cont = await handle(line)
        if (!cont) {
          alive = false
          rl.close()
          return
        }
      } catch (err) {
        console.log(paint("red", `Error: ${err.message}`))
      }
      if (alive) rl.prompt()
    })
  })
  rl.on("close", async () => {
    alive = false
    await prisma.$disconnect()
    process.exit(0)
  })
  rl.prompt()
}

main().catch((e) => {
  console.error(paint("red", `Fatal: ${e.message}`))
  process.exit(1)
})
