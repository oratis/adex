import { cookies } from 'next/headers'
import { prisma } from './prisma'
import crypto from 'crypto'
import bcrypt from 'bcrypt'

// bcrypt cost factor — 12 is a reasonable default for web apps in 2026
const BCRYPT_ROUNDS = 12

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

/**
 * Hash a password with bcrypt. Sync signature for backward compatibility
 * with existing call sites that don't await, but delegates to bcrypt
 * async for security — callers MUST await this.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

/**
 * Verify a password against a stored hash. Transparently handles:
 *  - bcrypt hashes (format: $2[aby]$...)
 *  - Legacy raw SHA-256 hex (64 hex chars) from before 2026-04
 * Returns { valid, needsUpgrade } — needsUpgrade=true if the stored hash
 * is in the legacy format and the password verified, so the caller can
 * rehash with bcrypt.
 */
export async function verifyPasswordDetailed(
  password: string,
  hash: string
): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  if (hash.startsWith('$2')) {
    const valid = await bcrypt.compare(password, hash)
    return { valid, needsUpgrade: false }
  }
  // Legacy SHA-256
  const legacy = crypto.createHash('sha256').update(password).digest('hex')
  return { valid: legacy === hash, needsUpgrade: legacy === hash }
}

/**
 * Back-compat wrapper — most routes just want boolean.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return (await verifyPasswordDetailed(password, hash)).valid
}

/**
 * Best-effort rehash: if a user's stored hash is still SHA-256 after a
 * successful login, upgrade it in-place to bcrypt. Fire-and-forget.
 */
export async function rehashIfLegacy(
  userId: string,
  rawPassword: string,
  currentHash: string
): Promise<void> {
  if (currentHash.startsWith('$2')) return
  try {
    const newHash = await hashPassword(rawPassword)
    await prisma.user.update({
      where: { id: userId },
      data: { password: newHash },
    })
  } catch (err) {
    console.error('[auth] bcrypt rehash failed:', err)
  }
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
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

/**
 * Create a Session row and return a signed token referencing it. This
 * is the canonical login flow — every new cookie should come from here
 * so sessions can be revoked.
 */
export async function createSession(opts: {
  userId: string
  userAgent?: string | null
  ipAddress?: string | null
  ttlSeconds?: number
}): Promise<string> {
  const ttl = opts.ttlSeconds ?? SESSION_MAX_AGE
  const session = await prisma.session.create({
    data: {
      userId: opts.userId,
      tokenHash: crypto.randomBytes(16).toString('hex'), // placeholder — we'll set below
      userAgent: opts.userAgent ?? null,
      ipAddress: opts.ipAddress ?? null,
      expiresAt: new Date(Date.now() + ttl * 1000),
    },
  })
  const token = signSessionToken(opts.userId, session.id, ttl)
  // Store hash of the final signed token for audit/lookup
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  await prisma.session.update({
    where: { id: session.id },
    data: { tokenHash },
  })
  return token
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

  const payload = verifySessionToken(token)
  if (payload) {
    // If the token has a session id, verify the row isn't revoked.
    // Tokens issued before the Session table exists have no sid and
    // remain stateless (they'll naturally expire after 30 days).
    if (payload.sid) {
      const session = await prisma.session.findUnique({
        where: { id: payload.sid },
      })
      if (!session || session.revokedAt || session.expiresAt < new Date()) {
        return null
      }
      // Opportunistically refresh lastSeenAt (throttled: only if it's
      // been more than a minute since the last update).
      const since = Date.now() - session.lastSeenAt.getTime()
      if (since > 60_000) {
        prisma.session
          .update({
            where: { id: session.id },
            data: { lastSeenAt: new Date() },
          })
          .catch(() => {})
      }
    }
    return prisma.user.findUnique({ where: { id: payload.uid } })
  }

  // Legacy path: pre-signed-token cookies stored raw user ID.
  // Accept only if it matches an existing user — migrated out on next login.
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

// ============================================================================
// Platform admin (cross-org)
// ============================================================================

/**
 * Platform admins can mint invite codes and promote/demote other platform
 * admins. They are different from org-level admins/owners.
 *
 * A user counts as platform admin if EITHER:
 *   - User.isPlatformAdmin column = true, OR
 *   - their email is in the comma-separated `PLATFORM_ADMIN_EMAILS` env var
 *
 * The env-var path exists so the very first install can bootstrap an admin
 * without needing a manual SQL UPDATE — set the env var and that user is
 * always a platform admin. Use it sparingly (1–2 emails); promote everyone
 * else through the UI which writes to the column.
 */
export function isPlatformAdmin(user: { email: string; isPlatformAdmin?: boolean | null } | null): boolean {
  if (!user) return false
  if (user.isPlatformAdmin) return true
  const env = (process.env.PLATFORM_ADMIN_EMAILS || '').toLowerCase()
  if (!env) return false
  const allow = env.split(',').map((s) => s.trim()).filter(Boolean)
  return allow.includes(user.email.toLowerCase())
}

/**
 * Throws if the current user isn't a platform admin. Use in any /api/admin/*
 * route handler.
 */
export async function requirePlatformAdmin() {
  const user = await requireAuth()
  if (!isPlatformAdmin(user)) {
    throw new Error('Platform admin only')
  }
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
