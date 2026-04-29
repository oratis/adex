import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'
import { prisma } from './prisma'

/**
 * Per-cron rotatable auth.
 *
 * Resolution order (first match wins):
 *   1. Active `CronSecret` row whose tokenHash matches sha256(provided header)
 *      for the given cronPath.
 *   2. Legacy single `CRON_SECRET` env var (fallback so existing scheduler
 *      configs keep working until rotated).
 *
 * Auth flow stays identical to callers — they just call `verifyCronAuth(req,
 * cronPath)` and get a boolean. Tokens are never logged in plaintext;
 * only the SHA-256 is stored.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function generateCronToken(): string {
  return `cron_${crypto.randomBytes(24).toString('base64url')}`
}

function readHeader(req: NextRequest): string | null {
  return (
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer /i, '') ||
    null
  )
}

export async function verifyCronAuth(
  req: NextRequest,
  cronPath: string
): Promise<boolean> {
  const provided = readHeader(req)
  if (!provided) return false

  // 1. Per-cron DB-backed secret
  try {
    const row = await prisma.cronSecret.findUnique({
      where: { cronPath },
    })
    if (row && row.isActive) {
      const givenHash = hashToken(provided)
      if (
        givenHash.length === row.tokenHash.length &&
        crypto.timingSafeEqual(Buffer.from(givenHash), Buffer.from(row.tokenHash))
      ) {
        // best-effort lastUsedAt update; don't fail auth if write fails
        prisma.cronSecret
          .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
          .catch(() => {})
        return true
      }
    }
  } catch {
    // table may not exist (pre-migration) → fall through to legacy
  }

  // 2. Legacy single env-var fallback
  const envSecret = process.env.CRON_SECRET
  if (envSecret && provided === envSecret) return true

  return false
}
