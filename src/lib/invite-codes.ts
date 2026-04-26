import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'

/**
 * Generate a human-shareable invite token. Avoids 0/O/I/1 to reduce
 * misreads when codes are typed by hand. Layout: `INVT-XXXX-XXXX-XXXX`.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateInviteCode(): string {
  const groups = Array.from({ length: 3 }, () => {
    let g = ''
    for (let i = 0; i < 4; i++) {
      g += ALPHABET[crypto.randomInt(0, ALPHABET.length)]
    }
    return g
  })
  return `INVT-${groups.join('-')}`
}

export type InviteValidation =
  | { ok: true; codeId: string }
  | { ok: false; reason: string }

/**
 * Look up an invite code, verify it's:
 *   - present
 *   - not used (`usedAt` null)
 *   - not revoked (`revokedAt` null)
 *   - not expired (`expiresAt` > now, or null)
 *
 * Pure validation — does NOT consume. Caller must consumeInviteCode() inside
 * the same transaction that creates the User to avoid race conditions on
 * concurrent registration with the same code.
 */
export async function validateInviteCode(rawCode: string): Promise<InviteValidation> {
  const code = rawCode.trim().toUpperCase()
  if (!code) return { ok: false, reason: 'Invite code required' }
  const row = await prisma.inviteCode.findUnique({ where: { code } })
  if (!row) return { ok: false, reason: 'Invite code not found' }
  if (row.revokedAt) return { ok: false, reason: 'Invite code has been revoked' }
  if (row.usedAt) return { ok: false, reason: 'Invite code already used' }
  if (row.expiresAt && row.expiresAt < new Date()) {
    return { ok: false, reason: 'Invite code has expired' }
  }
  return { ok: true, codeId: row.id }
}

/**
 * Mark an invite code as used. Race-safe via a conditional update + count
 * check — if a parallel registration consumed the same code first, this
 * returns `false` and the caller must roll back the registration.
 */
export async function consumeInviteCode(codeId: string, userId: string): Promise<boolean> {
  const result = await prisma.inviteCode.updateMany({
    where: { id: codeId, usedAt: null, revokedAt: null },
    data: { usedAt: new Date(), usedByUserId: userId },
  })
  return result.count === 1
}
