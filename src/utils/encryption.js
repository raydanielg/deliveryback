import crypto from "crypto"

// AES-256-GCM at-rest encryption for partner integration secrets (API keys, bearer tokens,
// basic-auth passwords, OAuth client secrets, webhook signing secrets). These must never be
// stored as plaintext columns and must never be returned by any API response — only the
// webhook dispatcher and outbound partner API client ever decrypt them, in-memory, per call.
// Falls back to deriving a key from JWT_SECRET so local/dev setups don't hard-fail before an
// operator has set a dedicated key, but production must set ENCRYPTION_KEY explicitly.
function getKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET
  if (!secret) {
    throw new Error("ENCRYPTION_KEY (or JWT_SECRET as fallback) must be set to encrypt/decrypt credentials")
  }
  return crypto.createHash("sha256").update(secret).digest()
}

export function encryptSecret(plaintextObjectOrString) {
  if (plaintextObjectOrString == null) return null
  const plaintext = typeof plaintextObjectOrString === "string"
    ? plaintextObjectOrString
    : JSON.stringify(plaintextObjectOrString)

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  // iv:authTag:ciphertext, all base64 — one string, safe to store in a single text column.
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`
}

export function decryptSecret(stored) {
  if (!stored) return null
  const [ivB64, tagB64, dataB64] = stored.split(":")
  if (!ivB64 || !tagB64 || !dataB64) return null

  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()])
  return decrypted.toString("utf8")
}

export function decryptSecretJson(stored) {
  const raw = decryptSecret(stored)
  if (raw == null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// Partner API keys: shown once at creation, stored only as a SHA-256 hash thereafter —
// mirrors how passwords are handled, since a leaked hash still can't be used to authenticate.
export function generateApiKey(environment = "live") {
  const random = crypto.randomBytes(24).toString("base64url")
  const key = `xk_${environment}_${random}`
  const prefix = key.slice(0, 14)
  const hash = crypto.createHash("sha256").update(key).digest("hex")
  return { key, prefix, hash }
}

export function hashApiKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex")
}
