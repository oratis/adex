import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { prisma } from '@/lib/prisma'
import { fetchAppStoreReviews, classifyReviews, type ReviewRecord } from '@/lib/growth/reviews'

/**
 * POST /api/cron/review-sync
 *
 * Pulls the public App Store review RSS for every org's iOS PromotedApp,
 * classifies them (LLM or rule-based fallback), and upserts AppReview rows
 * (idempotent by review id). Returns per-org counts incl. new P0 negatives.
 * Auth via X-Cron-Secret.
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §10 (P19)
 */

const COUNTRIES = ['us', 'gb']

export async function POST(req: NextRequest) {
  if (!(await verifyCronAuth(req, 'review-sync'))) {
    return NextResponse.json({ error: 'Unauthorized — set X-Cron-Secret header' }, { status: 401 })
  }

  const apps = await prisma.promotedApp.findMany({
    where: { platform: 'ios', storeId: { not: null } },
    select: { id: true, orgId: true, storeId: true },
  })

  const summary: Array<{ orgId: string; appId: string; reviews: number; p0: number; error?: string }> = []

  for (const app of apps) {
    try {
      const fetched: ReviewRecord[] = []
      for (const country of COUNTRIES) {
        try {
          fetched.push(...(await fetchAppStoreReviews(app.storeId!, country)))
        } catch {
          // one country failing shouldn't abort the app
        }
      }
      const classes = await classifyReviews(fetched)

      let p0 = 0
      for (const r of fetched) {
        const c = classes.get(r.id)
        if (c?.priority === 'P0') p0++
        await prisma.appReview.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            orgId: app.orgId,
            appId: app.id,
            source: r.source,
            country: r.country,
            rating: r.rating,
            title: r.title,
            body: r.body,
            reviewedAt: r.reviewedAt,
            sentiment: c?.sentiment ?? null,
            topics: c ? JSON.stringify(c.topics) : null,
            priority: c?.priority ?? null,
          },
          update: {
            sentiment: c?.sentiment ?? null,
            topics: c ? JSON.stringify(c.topics) : null,
            priority: c?.priority ?? null,
          },
        })
      }
      summary.push({ orgId: app.orgId, appId: app.id, reviews: fetched.length, p0 })
    } catch (err) {
      summary.push({ orgId: app.orgId, appId: app.id, reviews: 0, p0: 0, error: err instanceof Error ? err.message : 'review sync error' })
    }
  }

  return NextResponse.json({ ok: true, apps: summary })
}
