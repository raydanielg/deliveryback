import nodemailer from "nodemailer"

let transporter = null

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: parseInt(process.env.SMTP_PORT || "587") === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  }
  return transporter
}

export async function sendOtpEmail(email, otp, name) {
  const transport = getTransporter()

  const mailOptions = {
    from: process.env.SMTP_FROM || "Delivery Option <no-reply@deliveryoption.com>",
    to: email,
    subject: "Password Reset - Delivery Option",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #16a34a; font-size: 28px;">Delivery Option</h1>
        </div>
        <h2 style="color: #333;">Password Reset Request</h2>
        <p style="color: #555; font-size: 16px;">Hi ${name},</p>
        <p style="color: #555; font-size: 16px;">
          You requested a password reset. Use the verification code below to reset your password:
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <div style="display: inline-block; background: #f0fdf4; border: 2px solid #16a34a; border-radius: 12px; padding: 20px 40px;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #16a34a;">${otp}</span>
          </div>
        </div>
        <p style="color: #555; font-size: 16px;">
          This code will expire in <strong>10 minutes</strong>. If you didn't request this, please ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="color: #999; font-size: 14px; text-align: center;">
          Delivery Option &copy; ${new Date().getFullYear()}. All rights reserved.
        </p>
      </div>
    `,
  }

  await transport.sendMail(mailOptions)
}

export async function sendWelcomeEmail(email, name) {
  const transport = getTransporter()

  const mailOptions = {
    from: process.env.SMTP_FROM || "Delivery Option <no-reply@deliveryoption.com>",
    to: email,
    subject: "Welcome to Delivery Option!",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #16a34a; font-size: 28px;">Delivery Option</h1>
        </div>
        <h2 style="color: #333;">Welcome aboard, ${name}!</h2>
        <p style="color: #555; font-size: 16px;">
          Your account has been created successfully. You can now log in and start using Delivery Option.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="color: #999; font-size: 14px; text-align: center;">
          Delivery Option &copy; ${new Date().getFullYear()}. All rights reserved.
        </p>
      </div>
    `,
  }

  await transport.sendMail(mailOptions)
}
