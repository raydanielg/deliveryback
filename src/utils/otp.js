import crypto from "crypto"

export function generateOtp() {
  const digits = "0123456789"
  let otp = ""
  const bytes = crypto.randomBytes(6)
  for (let i = 0; i < 6; i++) {
    otp += digits[bytes[i] % 10]
  }
  return otp
}

export function generateToken() {
  return crypto.randomBytes(32).toString("hex")
}
