import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * GET /api/competitors?appName=&level=&orderBy=adDays|impressions&limit=
 *
 * Org-scoped listing of ingested competitor creatives (session auth — never
 * trusts a client-supplied orgId). `level` has no dedicated column (see
 * docs/growth/09-pipeline-adex-integration.md §3) — it's whatever the
 * source's classification stored under `rawMeta.level`, filtered via a
 * Postgres JSON-path match.
 *
 * Ref: docs/growth/09-pipeline-adex-integration.md §3
 */
export async function GET(req: NextRequest) {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = req.nextUrl.searchParams
    const appName = searchParams.get('appName')
    const level = searchParams.get('level')
    const orderByParam = searchParams.get('orderBy')
    const limitParam = searchParams.get('limit')

    const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 200)

    const where: Record<string, unknown> = { orgId: org.id }
    if (appName) where.appName = { contains: appName }
    if (level) where.rawMeta = { path: ['level'], equals: level }

    const orderBy: Record<string, 'asc' | 'desc'> =
      orderByParam === 'adDays'
        ? { adDays: 'desc' }
        : orderByParam === 'impressions'
          ? { impressions: 'desc' }
          : { ingestedAt: 'desc' }

    const rows = await prisma.competitorCreative.findMany({
      where,
      orderBy,
      take: limit,
    })

    // BigInt isn't JSON-serializable — stringify impressions.
    const serialized = rows.map((row) => ({
      ...row,
      impressions: row.impressions === null ? null : row.impressions.toString(),
    }))

    return NextResponse.json(serialized)
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}
