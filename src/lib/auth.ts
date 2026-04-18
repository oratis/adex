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

// ============================================================================
// Organizations
// ============================================================================

export const ACTIVE_ORG_COOKIE = 'adex_active_org'

export type OrgRole = 'owner' | 'admin' | 'member'

/**
 * Resolve the active organization for the current user.
 * Falls back to the first membership by creation date.
 * Ensures: the active_org_id cookie always refers to an org the user belongs to.
 */
export async function getCurrentOrg(userId: string) {
  const cookieStore = await cookies()
  const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value

  if (activeOrgId) {
    const membership = await prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId: activeOrgId, userId } },
      include: { org: true },
    })
    if (membership) return { org: membership.org, role: membership.role as OrgRole }
  }

  // Fallback: first membership (oldest → typically personal org)
  const membership = await prisma.orgMembership.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    include: { org: true },
  })
  if (!membership) return null
  return { org: membership.org, role: membership.role as OrgRole }
}

/**
 * Return the current user AND their active org. Throws if either missing.
 * Prefer this over requireAuth() + getCurrentOrg() everywhere possible.
 */
export async function requireAuthWithOrg() {
  const user = await requireAuth()
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) throw new Error('No organization — please sign out and back in')
  return { user, org: ctx.org, role: ctx.role }
}

/**
 * Helper for endpoints that need role-based access within an org.
 * Throws if the user's role is below the required level.
 */
export function assertRole(userRole: OrgRole, required: OrgRole): void {
  const order: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 }
  if (order[userRole] < order[required]) {
    throw new Error(`Requires ${required} role (current: ${userRole})`)
  }
}

/**
 * Create a personal org + OWNER membership for a newly-registered user.
 * Idempotent: safe to call on existing users.
 */
export async function ensurePersonalOrg(user: { id: string; email: string; name: string | null }) {
  const existing = await prisma.orgMembership.findFirst({
    where: { userId: user.id },
  })
  if (existing) return existing.orgId

  const base = (user.name || user.email.split('@')[0]).replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
  const slug = `ws-${base.slice(0, 20)}-${user.id.slice(0, 6)}`
  const orgName = `${user.name || user.email.split('@')[0]}'s workspace`

  const org = await prisma.organization.create({
    data: {
      name: orgName,
      slug,
      createdBy: user.id,
      members: {
        create: { userId: user.id, role: 'owner' },
      },
    },
  })
  return org.id
}
