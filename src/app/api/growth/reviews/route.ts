import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * GET /api/growth/reviews?sentiment=&priority=
 *
 * Recent classified app reviews for the org, newest first, with optional
 * sentiment / priority filters. The reviews view's data source.
 */
export async function GET(req: NextRequest) {
  let org
  try {
    ({ org } = await requireAuthWithOrg())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const sentiment = url.searchParams.get('sentiment') || undefined
  const priority = url.searchParams.get('priority') || undefined

  const reviews = await prisma.appReview.findMany({
    where: { orgId: org.id, sentiment, priority },
    orderBy: { reviewedAt: 'desc' },
    take: 100,
  })

  const rows = reviews.map((r) => ({
    id: r.id,
    source: r.source,
    country: r.country,
    rating: r.rating,
    title: r.title,
    body: r.body,
    reviewedAt: r.reviewedAt.toISOString().slice(0, 10),
    sentiment: r.sentiment,
    topics: r.topics ? (JSON.parse(r.topics) as string[]) : [],
    priority: r.priority,
  }))

  // Small aggregate for the header counts.
  const p0 = rows.filter((r) => r.priority === 'P0').length
  const negative = rows.filter((r) => r.sentiment === 'negative').length

  return NextResponse.json({ hasData: rows.length > 0, reviews: rows, p0, negative })
}
