import crypto from 'crypto'

function getSecret(): string {
  const secret = process.env.AUTH_TOKEN_SECRET || process.env.NEXTAUTH_SECRET || ''
  if (!secret) throw new Error('AUTH_TOKEN_SECRET (or NEXTAUTH_SECRET) is not set. Refusing unsigned sessions.')
  return secret
}

// HMAC-signed session token: base64url(payload).base64url(sig)
// payload includes a session id (sid) so we can revoke individual
// sessions server-side. Older tokens without sid (pre-v28) are still
// accepted (stateless) to avoid logging everyone out on deploy.
type SessionPayload = { uid: string; sid?: string; iat: number; exp: number }

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function sign(data: string): string {
  return b64urlEncode(
    crypto.createHmac('sha256', getSecret()).update(data).digest()
  )
}

export function signSessionToken(
  userId: string,
  sessionId?: string,
  ttlSeconds = 60 * 60 * 24 * 30
): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    uid: userId,
    ...(sessionId ? { sid: sessionId } : {}),
    iat: now,
    exp: now + ttlSeconds,
  }
  const payloadStr = b64urlEncode(Buffer.from(JSON.stringify(payload)))
  const sig = sign(payloadStr)
  return `${payloadStr}.${sig}`
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return null
    const [payloadStr, sig] = parts
    const expected = sign(payloadStr)
    // constant-time compare
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

    const payload = JSON.parse(b64urlDecode(payloadStr).toString('utf8')) as SessionPayload
    if (!payload.uid || !payload.exp) return null
    if (payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
