import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_DIR = path.join(__dirname, "..", "..", "logs")
const LOG_FILE = path.join(LOG_DIR, "requests.log")
const MAX_BYTES = 2 * 1024 * 1024 // rotate at ~2MB so the file never grows unbounded

try {
  fs.mkdirSync(LOG_DIR, { recursive: true })
} catch {
  /* ignore */
}

// Append one JSON-lines entry per finished request. The admin CLI tails this file
// to render a live request table. Writes are best-effort and never throw into the
// request path.
export function writeRequestLog(entry) {
  try {
    const { size } = fs.statSync(LOG_FILE)
    if (size > MAX_BYTES) {
      // keep the file bounded: truncate when it exceeds the cap
      fs.truncateSync(LOG_FILE, 0)
    }
  } catch {
    /* file may not exist yet */
  }
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n")
  } catch {
    /* never break the request on a logging failure */
  }
}

export const REQUEST_LOG_FILE = LOG_FILE
