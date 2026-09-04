const SMS_API_URL = process.env.SMS_API_URL || "http://mshastra.com/sendsms_api_json.aspx"
const SMS_USERNAME = process.env.SMS_USERNAME || "XERINDELIV"
const SMS_PASSWORD = process.env.SMS_PASSWORD || ""
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || "XERINDELIV"

export async function sendOtpSms(phone, otp, name) {
  const cleanPhone = phone.replace(/\s+/g, "").replace(/^\+/, "")

  const message = `Xerin Express: Hello ${name}, your verification code is ${otp}. It expires in 10 minutes. Do not share this code with anyone.`

  if (!SMS_PASSWORD) {
    console.log(`[SMS Mock] To: ${cleanPhone}, Message: ${message}`)
    return { success: true, providerId: "mock" }
  }

  const response = await fetch(SMS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: SMS_USERNAME,
      pwd: SMS_PASSWORD,
      senderid: SMS_SENDER_ID,
      mobilenumber: cleanPhone,
      message: message,
    }),
  })

  const data = await response.text()

  if (!response.ok) {
    throw new Error(`SMS gateway error: ${data}`)
  }

  return { success: true, providerId: data }
}

export async function sendSms(phone, message) {
  const cleanPhone = phone.replace(/\s+/g, "").replace(/^\+/, "")

  if (!SMS_PASSWORD) {
    console.log(`[SMS Mock] To: ${cleanPhone}, Message: ${message}`)
    return { success: true, providerId: "mock" }
  }

  const response = await fetch(SMS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: SMS_USERNAME,
      pwd: SMS_PASSWORD,
      senderid: SMS_SENDER_ID,
      mobilenumber: cleanPhone,
      message: message,
    }),
  })

  const data = await response.text()

  if (!response.ok) {
    throw new Error(`SMS gateway error: ${data}`)
  }

  return { success: true, providerId: data }
}
