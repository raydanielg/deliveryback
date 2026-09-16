import { exec } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import dotenv from "dotenv"
import nodemailer from "nodemailer"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ALERT_EMAIL = process.env.ALERT_EMAIL || "airezra2@gmail.com"
const FROM_EMAIL = process.env.SMTP_FROM || "Xerin Security <contact@neg.co.tz>"
const SMTP_HOST = process.env.SMTP_HOST
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "465", 10)
const SMTP_USER = process.env.SMTP_USER
const SMTP_PASS = process.env.SMTP_PASS

const API_URL = process.env.MONITOR_API_URL || `http://127.0.0.1:${process.env.PORT || 4000}/health`
const DOMAINS = (process.env.MONITOR_DOMAINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
const LOG_FILE = process.env.MONITOR_LOG || "/var/log/xerin-security-monitor.log"
const STATE_FILE = process.env.MONITOR_STATE || path.join(__dirname, "monitor-state.json")
const INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL || "60", 10) * 1000

const CPU_THRESHOLD = parseInt(process.env.CPU_THRESHOLD || "80", 10)
const RAM_THRESHOLD = parseInt(process.env.RAM_THRESHOLD || "80", 10)
const DISK_THRESHOLD = parseInt(process.env.DISK_THRESHOLD || "85", 10)
const LOAD_MULTIPLIER = parseFloat(process.env.LOAD_MULTIPLIER || "0.8")
const SSH_FAILURE_THRESHOLD = parseInt(process.env.SSH_FAILURE_THRESHOLD || "20", 10)
const SSL_DAYS_WARNING = parseInt(process.env.SSL_DAYS_WARNING || "14", 10)

const COOLDOWN_MS = {
  CRITICAL: parseInt(process.env.CRITICAL_COOLDOWN || "300000", 10),
  WARNING: parseInt(process.env.WARNING_COOLDOWN || "900000", 10),
  INFO: parseInt(process.env.INFO_COOLDOWN || "3600000", 10),
  SECURITY: parseInt(process.env.SECURITY_COOLDOWN || "300000", 10),
}

const alertHistory = new Map()
let transporter = null

function getTransporter() {
  if (transporter) return transporter
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP not configured")
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  })
  return transporter
}

function shell(cmd, timeout = 15000) {
  return new Promise((resolve) => {
    const child = exec(cmd, { timeout }, (error, stdout, stderr) => {
      resolve({
        code: child.exitCode || (error ? 1 : 0),
        stdout: stdout?.trim() || "",
        stderr: stderr?.trim() || "",
      })
    })
  })
}

async function log(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`
  process.stdout.write(line)
  try {
    await fs.appendFile(LOG_FILE, line)
  } catch {
    // If we cannot write the log, at least it is in stdout
  }
}

async function sendAlert(level, title, body) {
  const key = `${level}:${title}`
  const last = alertHistory.get(key)
  const now = Date.now()
  if (last && now - last < (COOLDOWN_MS[level] || 300000)) {
    return
  }
  alertHistory.set(key, now)

  const text = `[${level}] ${title}\n\nServer: ${os.hostname()}\nTime: ${new Date().toISOString()}\n\n${body}`
  const html = `<pre style="font-family:monospace;font-size:14px;line-height:1.6">${text.replace(/</g, "&lt;")}</pre>`

  await log(level, `${title} - ${body}`)

  try {
    const transport = getTransporter()
    await transport.sendMail({
      from: FROM_EMAIL,
      to: ALERT_EMAIL,
      subject: `[${level}] ${title} - ${os.hostname()}`,
      text,
      html,
    })
    await log("INFO", `Alert email sent: ${title}`)
  } catch (err) {
    await log("WARNING", `Failed to send email for "${title}": ${err.message}`)
  }
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8")
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeState(state) {
  try {
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    await log("WARNING", `Could not write monitor state: ${err.message}`)
  }
}

async function checkApiHealth() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(API_URL, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    await log("INFO", `API health OK (${API_URL})`)
  } catch (err) {
    await sendAlert(
      "CRITICAL",
      "Xerin Express API DOWN",
      `Endpoint: ${API_URL}\nError: ${err.message}\nAction: Check PM2 and reverse proxy immediately.`
    )
  }
}

async function checkPostgres() {
  const r = await shell("pg_isready -h 127.0.0.1 -p 5432")
  if (r.code !== 0) {
    await sendAlert("CRITICAL", "PostgreSQL not ready", `pg_isready returned: ${r.stdout || r.stderr}`)
  } else {
    await log("INFO", "PostgreSQL OK")
  }
}

async function checkPM2() {
  const r = await shell("pm2 jlist")
  if (r.code !== 0) {
    await sendAlert("WARNING", "PM2 status check failed", r.stderr || r.stdout)
    return
  }
  let list
  try {
    list = JSON.parse(r.stdout || "[]")
  } catch {
    await sendAlert("WARNING", "PM2 JSON parse failed", r.stdout.slice(0, 500))
    return
  }

  const state = await readState()
  for (const proc of list) {
    if (!["delivery-api", "xerinexpress-web"].includes(proc.name)) continue
    if (proc.pm2_env?.status !== "online") {
      await sendAlert(
        "CRITICAL",
        `${proc.name} is not online`,
        `Status: ${proc.pm2_env?.status}\nRestarts: ${proc.pm2_env?.restart_time}`
      )
    } else {
      const prev = state.restarts?.[proc.name] ?? proc.pm2_env?.restart_time
      const restarts = proc.pm2_env?.restart_time ?? 0
      if (restarts > prev) {
        await sendAlert(
          "WARNING",
          `${proc.name} restarted`,
          `Previous restarts: ${prev}\nCurrent restarts: ${restarts}\nCheck logs with: pm2 logs ${proc.name}`
        )
      }
      state.restarts = state.restarts || {}
      state.restarts[proc.name] = restarts
    }
  }
  await writeState(state)
}

async function checkResources() {
  // RAM
  const total = os.totalmem()
  const used = total - os.freemem()
  const ramPct = Math.round((used / total) * 100)
  if (ramPct > RAM_THRESHOLD) {
    await sendAlert("WARNING", "RAM usage high", `Used: ${ramPct}% (${Math.round(used / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)`)
  }

  // Load
  const cores = os.cpus().length || 1
  const load = os.loadavg()[0]
  const loadPct = load / cores
  if (loadPct > LOAD_MULTIPLIER) {
    await sendAlert("WARNING", "CPU load high", `Load average: ${load.toFixed(2)} (cores: ${cores}, ratio: ${loadPct.toFixed(2)})`)
  }

  // Disk
  const r = await shell("df -h / --output=pcent | tail -1")
  const diskPct = parseInt(r.stdout?.replace("%", "").trim() || "0", 10)
  if (diskPct > DISK_THRESHOLD) {
    await sendAlert("WARNING", "Disk usage high", `Root disk: ${diskPct}%`)
  }
}

async function checkSSHBruteForce() {
  const r = await shell('journalctl -u ssh --since "1 hour ago" --no-pager | tail -500')
  if (r.code !== 0) return

  const failed = (r.stdout.match(/Failed password for/g) || []).length
  const invalid = (r.stdout.match(/Invalid user/g) || []).length

  if (failed + invalid > SSH_FAILURE_THRESHOLD) {
    const ips = {}
    const ipMatches = r.stdout.match(/from\s+([\d.]+)\s+port/g) || []
    for (const m of ipMatches) {
      const ip = m.match(/from\s+([\d.]+)\s+port/)[1]
      ips[ip] = (ips[ip] || 0) + 1
    }
    const topIps = Object.entries(ips)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ip, count]) => `${ip}: ${count}`)
      .join("\n")

    await sendAlert(
      "SECURITY",
      "Possible SSH brute-force attack",
      `Failed password attempts: ${failed}\nInvalid user attempts: ${invalid}\nTop source IPs:\n${topIps || "none captured"}`
    )
  }
}

async function checkSSL() {
  for (const domain of DOMAINS) {
    const r = await shell(
      `echo | openssl s_client -connect ${domain}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -enddate`
    )
    if (r.code !== 0) {
      await sendAlert("WARNING", `SSL check failed for ${domain}`, r.stderr || r.stdout)
      continue
    }
    const m = r.stdout.match(/notAfter=(.+)/)
    if (!m) continue
    const expiry = new Date(m[1].trim())
    const days = Math.ceil((expiry - Date.now()) / 86400000)
    if (days < SSL_DAYS_WARNING) {
      await sendAlert(
        "WARNING",
        `SSL certificate expiring soon for ${domain}`,
        `Expiry: ${expiry.toISOString()}\nDays remaining: ${days}`
      )
    }
  }
}

async function runCycle() {
  await log("INFO", "--- monitor cycle start ---")
  await checkApiHealth()
  await checkPostgres()
  await checkPM2()
  await checkResources()
  await checkSSHBruteForce()
  if (DOMAINS.length) await checkSSL()
  await log("INFO", "--- monitor cycle end ---")
}

async function main() {
  await log("INFO", `Xerin security monitor started (interval: ${INTERVAL_MS}ms)`)
  await runCycle()
  setInterval(runCycle, INTERVAL_MS)
}

main().catch(async (err) => {
  await log("CRITICAL", `Monitor crashed: ${err.message}`)
  process.exit(1)
})
