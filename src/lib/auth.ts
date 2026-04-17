import { cookies } from 'next/headers'
import { prisma } from './prisma'
import crypto from 'crypto'

const TOKEN_SECRET =
  process.env.AUTH_TOKEN_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  ''

function getSecret(): string {
  if (!TOKEN_SECRET) {
    throw new Error(
      'AUTH_TOKEN_SECRET (or NEXTAUTH_SECRET) is not set. Refusing to sign/verify tokens with an empty secret.'
    )
  }
  return TOKEN_SECRET
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex')
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// HMAC-signed session token: base64url(payload).base64url(sig)
// payload = { uid, iat, exp } as JSON
type SessionPayload = { uid: string; iat: number; exp: number }

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

export function signSessionToken(userId: string, ttlSeconds = 60 * 60 * 24 * 30): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = { uid: userId, iat: now, exp: now + ttlSeconds }
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

export async function getCurrentUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth_token')?.value
  if (!token) return null

  // New-format signed tokens
  const payload = verifySessionToken(token)
  if (payload) {
    return prisma.user.findUnique({ where: { id: payload.uid } })
  }

  // Legacy path: the cookie previously stored the raw user ID.
  // Accept it ONLY if the value matches an existing user. This lets
  // already-logged-in users keep their session until it's refreshed
  // on next login. Remove after all clients have re-logged in.
  if (/^[a-z0-9]{20,}$/i.test(token)) {
    const user = await prisma.user.findUnique({ where: { id: token } })
    return user
  }

  return null
}

export async function requireAuth() {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')
  return user
}

export const SESSION_COOKIE = 'auth_token'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days
