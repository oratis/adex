import { NextRequest, NextResponse } from 'next/server'
import type { Prisma, CompetitorCreative } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * GET /api/competitors — read-only competitor-intel list for the panel.
 *
 * Query params (all optional):
 *   app          — case-insensitive substring on appName
 *   relevance    — exact match (core | adjacent-dating | ...)
 *   adDays       — minimum days-in-flight (evergreen floor)
 *   sellingPoint — substring within the sellingPoints array (matched in memory;
 *                  the column is JSON, so we avoid provider-specific operators)
 *   sort         — impressions | adDays | recent (default: recent)
 *   limit        — page size (default 50, max 200)
 *   offset       — page offset (default 0)
 *
 * Always scoped to the caller's active org — a client-supplied org id is never
 * trusted. Ref: docs/growth/06-competitor-intel-remix.md §3.1
 */
const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50
// Upper bound scanned from the DB before the in-memory sellingPoint filter, so
// paging stays correct without pulling an unbounded set.
const SCAN_CAP = 1000

export async function GET(req: NextRequest) {
  let orgId: string
  try {
    const ctx = await requireAuthWithOrg()
    orgId = ctx.org.id
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = new URL(req.url).searchParams
  const app = sp.get('app')?.trim()
  const relevance = sp.get('relevance')?.trim()
  const sellingPoint = sp.get('sellingPoint')?.trim().toLowerCase()
  const sort = sp.get('sort') ?? 'recent'
  const limit = clampInt(sp.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
  const offset = Math.max(clampInt(sp.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER), 0)

  const where: Prisma.CompetitorCreativeWhereInput = { orgId }
  // `id` — exact-match lookup for the Remix-studio handoff (?competitorId=).
  const id = sp.get('id')?.trim()
  if (id) where.id = id
  if (app) where.appName = { contains: app, mode: 'insensitive' }
  if (relevance) where.relevance = relevance
  const adDaysMin = sp.get('adDays')
  if (adDaysMin != null) {
    const n = parseInt(adDaysMin, 10)
    if (Number.isFinite(n)) where.adDays = { gte: n }
  }

  const orderBy: Prisma.CompetitorCreativeOrderByWithRelationInput[] =
    sort === 'impressions'
      ? [{ impressions: { sort: 'desc', nulls: 'last' } }, { ingestedAt: 'desc' }]
      : sort === 'adDays'
        ? [{ adDays: { sort: 'desc', nulls: 'last' } }, { ingestedAt: 'desc' }]
        : [{ ingestedAt: 'desc' }]

  try {
    if (sellingPoint) {
      // sellingPoints is a JSON array column — filter in memory to stay portable
      // (no provider-specific JSON operators). Scan a bounded window, then page;
      // total + paging are capped at SCAN_CAP (surfaced via `scanCapped`).
      const scanned = await prisma.competitorCreative.findMany({ where, orderBy, take: SCAN_CAP })
      const matched = scanned.filter(
        (r) =>
          Array.isArray(r.sellingPoints) &&
          (r.sellingPoints as unknown[]).some((s) => String(s).toLowerCase().includes(sellingPoint)),
      )
      const page = matched.slice(offset, offset + limit)
      return NextResponse.json({
        competitors: page.map(serialize),
        count: page.length,
        total: matched.length,
        scanCapped: scanned.length === SCAN_CAP,
        limit,
        offset,
      })
    }

    // Scalar filters — let the DB page (skip/take) and count for an accurate total.
    const [total, rows] = await Promise.all([
      prisma.competitorCreative.count({ where }),
      prisma.competitorCreative.findMany({ where, orderBy, skip: offset, take: limit }),
    ])
    return NextResponse.json({
      competitors: rows.map(serialize),
      count: rows.length,
      total,
      limit,
      offset,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load competitors' }, { status: 500 })
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw != null ? parseInt(raw, 10) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

/** BigInt is not JSON-serializable — emit impressions as a lossless string. */
function serialize(r: CompetitorCreative) {
  return { ...r, impressions: r.impressions == null ? null : r.impressions.toString() }
}
