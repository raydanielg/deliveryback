import nodemailer from "nodemailer"

let transporter = null

function getTransporter() {
  if (!transporter) {
    const host = process.env.SMTP_HOST
    const port = parseInt(process.env.SMTP_PORT || "465")
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS

    console.log(`[EMAIL] Creating transporter: ${host}:${port} (secure: ${port === 465}), user: ${user}`)

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    })
  }
  return transporter
}

export async function verifyEmailConnection() {
  try {
    const transport = getTransporter()
    await transport.verify()
    console.log("[EMAIL] SMTP connection verified successfully")
    return true
  } catch (err) {
    console.error("[EMAIL] SMTP connection failed:", err.message)
    return false
  }
}

const EMAIL_WRAPPER = (content) => `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: linear-gradient(135deg, #E8732A 0%, #F2905A 100%); padding: 32px 24px; text-align: center;">
      <h1 style="color: #ffffff; font-size: 26px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">Xerin Express</h1>
      <p style="color: rgba(255,255,255,0.8); font-size: 13px; margin: 6px 0 0 0;">Deliver smarter, ship faster</p>
    </div>
    <div style="padding: 32px 24px;">
      ${content}
    </div>
    <div style="background: #f8f9fa; padding: 20px 24px; text-align: center;">
      <p style="color: #999; font-size: 12px; margin: 0;">
        Xerin Express &copy; ${new Date().getFullYear()}. All rights reserved.<br/>
        <a href="mailto:support@xerinexpress.com" style="color: #E8732A; text-decoration: none;">support@xerinexpress.com</a>
      </p>
    </div>
  </div>
`

export async function sendOtpEmail(email, otp, name) {
  const transport = getTransporter()

  const mailOptions = {
    from: process.env.SMTP_FROM || "Xerin Express <contact@neg.co.tz>",
    to: email,
    subject: "Password Reset - Xerin Express",
    html: EMAIL_WRAPPER(`
      <h2 style="color: #1a1a1a; font-size: 20px; margin: 0 0 16px 0;">Password Reset Request</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; font-size: 15px; line-height: 1.6;">
        You requested a password reset. Use the verification code below to reset your password:
      </p>
      <div style="text-align: center; margin: 28px 0;">
        <div style="display: inline-block; background: #fff5ed; border: 2px solid #E8732A; border-radius: 12px; padding: 20px 40px;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #E8732A;">${otp}</span>
        </div>
      </div>
      <p style="color: #555; font-size: 14px; line-height: 1.6;">
        This code will expire in <strong>10 minutes</strong>. If you didn't request this, please ignore this email.
      </p>
    `),
  }

  console.log(`[EMAIL] Sending OTP email to: ${email}`)
  const info = await transport.sendMail(mailOptions)
  console.log(`[EMAIL] OTP email sent successfully. MessageId: ${info.messageId}, Response: ${info.response}`)
  return info
}

export async function sendWelcomeEmail(email, name) {
  const transport = getTransporter()

  const mailOptions = {
    from: process.env.SMTP_FROM || "Xerin Express <contact@neg.co.tz>",
    to: email,
    subject: "Welcome to Xerin Express!",
    html: EMAIL_WRAPPER(`
      <h2 style="color: #1a1a1a; font-size: 20px; margin: 0 0 16px 0;">Welcome aboard, ${name}!</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6;">
        Your account has been created successfully. You can now log in and start using Xerin Express to manage your shipments, track packages, and get instant quotes.
      </p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${process.env.CLIENT_URL || 'https://swg.xerinexpress.com'}/auth" style="display: inline-block; background: #E8732A; color: #ffffff; font-size: 15px; font-weight: 700; padding: 14px 36px; border-radius: 10px; text-decoration: none;">Get Started</a>
      </div>
      <p style="color: #555; font-size: 14px; line-height: 1.6;">
        If you have any questions, feel free to reach out to our support team.
      </p>
    `),
  }

  console.log(`[EMAIL] Sending welcome email to: ${email}`)
  const info = await transport.sendMail(mailOptions)
  console.log(`[EMAIL] Welcome email sent successfully. MessageId: ${info.messageId}, Response: ${info.response}`)
  return info
}
