/**
 * Lightweight SMTP sender built on top of nodemailer.
 *
 * Configured via env vars:
 *   SMTP_HOST       (e.g. smtp.sendgrid.net)
 *   SMTP_PORT       (587 default)
 *   SMTP_SECURE     ("true" forces TLS, default false for STARTTLS)
 *   SMTP_USER       (SMTP auth username)
 *   SMTP_PASS       (SMTP auth password / api key)
 *   MAIL_FROM       (e.g. "Adex <no-reply@example.com>")
 *
 * If SMTP is not configured we fall back to a no-op that logs and reports
 * success:false — the digest route still saves the digest to the DB.
 */
import nodemailer from 'nodemailer'

let cachedTransport: nodemailer.Transporter | null = null

function getTransport(): nodemailer.Transporter | null {
  if (cachedTransport) return cachedTransport
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })
  return cachedTransport
}

export type SendMailResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: string }

export async function sendMail(opts: {
  to: string
  subject: string
  html: string
  text?: string
}): Promise<SendMailResult> {
  const transport = getTransport()
  if (!transport) {
    return {
      ok: false,
      reason:
        'SMTP not configured (set SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM env vars)',
    }
  }
  const from =
    process.env.MAIL_FROM ||
    process.env.SMTP_USER ||
    'no-reply@localhost'

  try {
    const info = await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text || opts.html.replace(/<[^>]+>/g, ''),
    })
    return { ok: true, messageId: info.messageId }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'SMTP send failed',
    }
  }
}
