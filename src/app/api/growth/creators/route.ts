import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { effectiveCpi } from '@/lib/growth/kpi-canon'

/**
 * GET /api/growth/creators
 *
 * KOL partnerships with their posts, plus a blended effective CPI per
 * partnership (cost / total uplift installs). The creators view's data source.
 */
export async function GET() {
  let org
  try {
    ({ org } = await requireAuthWithOrg())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const partnerships = await prisma.creatorPartnership.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: 'desc' },
    include: { posts: { orderBy: { publishedAt: 'desc' } } },
  })

  const rows = partnerships.map((p) => {
    const totalUplift = p.posts.reduce((s, po) => s + po.upliftInstalls, 0)
    const totalViews = p.posts.reduce((s, po) => s + po.views, 0)
    return {
      id: p.id,
      name: p.name,
      platform: p.platform,
      handle: p.handle,
      status: p.status,
      costUsd: p.costUsd,
      posts: p.posts.map((po) => ({
        id: po.id,
        url: po.url,
        publishedAt: po.publishedAt ? po.publishedAt.toISOString().slice(0, 10) : null,
        views: po.views,
        upliftInstalls: po.upliftInstalls,
        effectiveCpi: po.effectiveCpi,
      })),
      totalUplift,
      totalViews,
      blendedCpi: effectiveCpi(p.costUsd, totalUplift),
    }
  })

  return NextResponse.json({ hasData: rows.length > 0, partnerships: rows })
}
