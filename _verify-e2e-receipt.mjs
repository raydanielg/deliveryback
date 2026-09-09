import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()
const BASE = "http://localhost:4000/api/v1"
const suffix = Date.now()

let results = []
function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail })
  console.log((cond ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""))
}

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`login failed: ${JSON.stringify(json)}`)
  return json.data.token
}

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 10)
  const custA = await prisma.user.create({
    data: { name: "E2E Receipt A", email: `e2erecpt-a-${suffix}@test.local`, password: passwordHash, role: "CUSTOMER", isVerified: true, isActive: true },
  })

  const orderA = await prisma.order.create({
    data: { orderNumber: `E2ERCPT-${suffix}`, createdById: custA.id, totalAmount: 5000, currency: "TZS", status: "CREATED", paymentStatus: "PENDING" },
  })

  // Simulate a PaymentRequest + its confirmed Payment exactly as
  // payment-gateways/controller.js's applyConfirmedPayment() would leave them,
  // to test getPaymentRequestStatus's new paymentId lookup end-to-end.
  const reference = `PRQ-E2E-${suffix}`
  const paymentRequest = await prisma.paymentRequest.create({
    data: {
      reference,
      orderId: orderA.id,
      payerId: custA.id,
      paymentAmount: 5000,
      currencyCode: "TZS",
      status: "PAID",
      isPaid: true,
    },
  })
  const payment = await prisma.payment.create({
    data: {
      paymentRef: reference, orderId: orderA.id, payerId: custA.id,
      amount: 5000, currency: "TZS", method: "MOBILE_MONEY", status: "PAID",
      transactionId: reference, paidAt: new Date(),
    },
  })

  const tokenA = await login(custA.email, "Password123!")

  // This is exactly what the web /ship page's pollPaymentStatus() calls
  let res = await fetch(`${BASE}/payment-gateways/requests/${paymentRequest.id}/status`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  const json = await res.json()
  check("getPaymentRequestStatus: 200", res.status === 200, `status=${res.status}`)
  check("getPaymentRequestStatus: status=PAID", json.data?.status === "PAID", `status=${json.data?.status}`)
  check("getPaymentRequestStatus: paymentId matches the real Payment row", json.data?.paymentId === payment.id, `got=${json.data?.paymentId} want=${payment.id}`)

  // Now use that paymentId exactly as viewReceipt() would
  res = await fetch(`${BASE}/payments/${json.data?.paymentId}/receipt`, { headers: { Authorization: `Bearer ${tokenA}` } })
  const buf = Buffer.from(await res.arrayBuffer())
  check("end-to-end: receipt downloads as a real PDF via the paymentId from status polling", res.status === 200 && buf.slice(0, 4).toString() === "%PDF", `status=${res.status} magic=${buf.slice(0,4).toString()}`)

  console.log("\n=== SUMMARY ===")
  const failed = results.filter(x => !x.pass)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log("FAILED:")
    for (const f of failed) console.log(" - " + f.name + " " + f.detail)
  }

  // cleanup
  await prisma.payment.deleteMany({ where: { orderId: orderA.id } })
  await prisma.paymentRequest.deleteMany({ where: { orderId: orderA.id } })
  await prisma.order.deleteMany({ where: { id: orderA.id } })
  await prisma.user.deleteMany({ where: { id: custA.id } })
  console.log("Cleanup done.")

  process.exit(failed.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error("SCRIPT ERROR:", e)
  process.exit(2)
})
