const SMS_API_URL = process.env.SMS_API_URL || "http://mshastra.com/sendsms_api_json.aspx"
const SMS_USERNAME = process.env.SMS_USERNAME || "XERINDELIV"
const SMS_PASSWORD = process.env.SMS_PASSWORD || ""
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || "XERINDELIV"

function normalizePhone(phone) {
  let cleanPhone = phone.replace(/\s+/g, "").replace(/^\+/, "")
  if (cleanPhone.startsWith("255")) {
  } else if (cleanPhone.startsWith("0")) {
    cleanPhone = "255" + cleanPhone.substring(1)
  }
  return cleanPhone
}

async function callSmsGateway(cleanPhone, message) {
  const payload = {
    user: SMS_USERNAME,
    pwd: SMS_PASSWORD,
    senderid: SMS_SENDER_ID,
    mobilenumber: cleanPhone,
    message: message,
  }

  console.log(`[SMS] Sending to ${cleanPhone} via ${SMS_API_URL}`)
  console.log(`[SMS] Payload:`, JSON.stringify(payload))

  const response = await fetch(SMS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  const rawBody = await response.text()
  console.log(`[SMS] Gateway response status: ${response.status}`)
  console.log(`[SMS] Gateway response body: ${rawBody}`)

  if (!response.ok) {
    throw new Error(`SMS gateway HTTP error ${response.status}: ${rawBody}`)
  }

  let parsed = null
  try {
    parsed = JSON.parse(rawBody)
  } catch {
  }

  if (parsed) {
    const status = parsed.Status || parsed.status || parsed.result || ""
    const errorCode = parsed.ErrorCode || parsed.errorCode || parsed.error_code || ""
    const errorMsg = parsed.ErrorMessage || parsed.errorMessage || parsed.Message || parsed.message || ""

    if (status && String(status).toLowerCase() !== "success" && status !== "0" && status !== 0) {
      throw new Error(`SMS gateway error: ${status} ${errorCode} ${errorMsg}`)
    }
    if (errorCode && errorCode !== "0" && errorCode !== 0 && errorCode !== "000") {
      throw new Error(`SMS gateway error code ${errorCode}: ${errorMsg}`)
    }
  } else {
    const lower = rawBody.toLowerCase().trim()
    if (lower.includes("error") || lower.includes("fail") || lower.includes("invalid") || lower.includes("denied")) {
      throw new Error(`SMS gateway error: ${rawBody}`)
    }
  }

  return { success: true, providerId: parsed ? JSON.stringify(parsed) : rawBody }
}

export async function sendOtpSms(phone, otp, name) {
  const cleanPhone = normalizePhone(phone)

  const message = `Xerin Express: Hello ${name}, your verification code is ${otp}. It expires in 10 minutes. Do not share this code with anyone.`

  if (!SMS_PASSWORD) {
    console.log(`[SMS Mock] To: ${cleanPhone}, Message: ${message}`)
    return { success: true, providerId: "mock" }
  }

  return await callSmsGateway(cleanPhone, message)
}

export async function sendSms(phone, message) {
  const cleanPhone = normalizePhone(phone)

  if (!SMS_PASSWORD) {
    console.log(`[SMS Mock] To: ${cleanPhone}, Message: ${message}`)
    return { success: true, providerId: "mock" }
  }

  return await callSmsGateway(cleanPhone, message)
}
