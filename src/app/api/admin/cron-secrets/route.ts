import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/auth'
import { generateCronToken, hashToken } from '@/lib/cron-auth'

const KNOWN_PATHS = [
  'agent',
  'agent-expire',
  'agent-retention',
  'agent-weekly',
  'daily',
  'webhook-retry',
] as const

/**
 * GET  /api/admin/cron-secrets — list all per-cron secrets (no plaintext).
 * POST /api/admin/cron-secrets — body: { cronPath, description? } — generate
 *      a new token for that path. Returns the plaintext ONCE in the response;
 *      it's never stored or returned again. If a row exists, this rotates.
 */
export async function GET() {
  let admin
  try {
    admin = await requirePlatformAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  void admin
  const rows = await prisma.cronSecret.findMany({ orderBy: { cronPath: 'asc' } })
  return NextResponse.json({
    knownPaths: KNOWN_PATHS,
    secrets: rows.map((r) => ({
      id: r.id,
      cronPath: r.cronPath,
      description: r.description,
      createdAt: r.createdAt.toISOString(),
      rotatedAt: r.rotatedAt?.toISOString() ?? null,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      isActive: r.isActive,
    })),
  })
}

export async function POST(req: NextRequest) {
  let admin
  try {
    admin = await requirePlatformAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  const body = await req.json().catch(() => ({}))
  const cronPath = String(body.cronPath || '')
  if (!(KNOWN_PATHS as readonly string[]).includes(cronPath)) {
    return NextResponse.json(
      { error: `cronPath must be one of: ${KNOWN_PATHS.join(', ')}` },
      { status: 400 }
    )
  }
  const description = typeof body.description === 'string' ? body.description.slice(0, 200) : null
  const token = generateCronToken()
  const tokenHash = hashToken(token)

  const existing = await prisma.cronSecret.findUnique({ where: { cronPath } })
  if (existing) {
    await prisma.cronSecret.update({
      where: { id: existing.id },
      data: {
        tokenHash,
        description: description ?? existing.description,
        rotatedAt: new Date(),
        isActive: true,
        createdBy: admin.id,
      },
    })
  } else {
    await prisma.cronSecret.create({
      data: { cronPath, tokenHash, description, createdBy: admin.id },
    })
  }
  return NextResponse.json({
    cronPath,
    token,
    note: 'Store this token now — it will not be shown again. Update your scheduler config to use this value as X-Cron-Secret header.',
  })
}
