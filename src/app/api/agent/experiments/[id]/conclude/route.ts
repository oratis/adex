import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { compareProportions } from '@/lib/agent/experiments/significance'

/**
 * POST /api/agent/experiments/{id}/conclude
 *
 * Pulls last 7d of campaign-level reports for each arm's adLinkId, runs a
 * two-proportion z-test on the primary metric, and stores result on the
 * Experiment. The arm with the higher rate is the winner *iff* p < 0.05.
 *
 * primaryMetric can be 'ctr' (clicks/impressions) or 'cvr' (conversions/clicks).
 * Other metrics fall back to 'neutral' result with a note.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let org, role
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
    role = ctx.role
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Owner/admin only' }, { status: 403 })
  }
  const { id } = await params
  const exp = await prisma.experiment.findFirst({
    where: { id, orgId: org.id },
    include: { arms: true },
  })
  if (!exp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (exp.arms.length !== 2) {
    return NextResponse.json(
      { error: 'Only 2-arm experiments supported in v1' },
      { status: 400 }
    )
  }

  const since = exp.startedAt
  // Fetch ad-level reports per arm (P11 stored level=ad — fallback to campaign-level if absent)
  const armStats = await Promise.all(
    exp.arms.map(async (arm) => {
      const reports = await prisma.report.findMany({
        where: {
          orgId: org.id,
          OR: [{ adLinkId: arm.adLinkId }, { adGroupLinkId: arm.adLinkId }],
          date: { gte: since },
        },
      })
      const sum = reports.reduce(
        (a, r) => ({
          impressions: a.impressions + r.impressions,
          clicks: a.clicks + r.clicks,
          conversions: a.conversions + r.conversions,
        }),
        { impressions: 0, clicks: 0, conversions: 0 }
      )
      return { arm, ...sum }
    })
  )

  let result: Record<string, unknown> = { primaryMetric: exp.primaryMetric }
  if (exp.primaryMetric === 'ctr') {
    const cmp = compareProportions(
      { successes: armStats[0].clicks, trials: armStats[0].impressions },
      { successes: armStats[1].clicks, trials: armStats[1].impressions }
    )
    result = {
      ...result,
      ...cmp,
      winner: cmp.significant ? (cmp.z > 0 ? armStats[1].arm.name : armStats[0].arm.name) : null,
      arms: armStats.map((s) => ({
        name: s.arm.name,
        impressions: s.impressions,
        clicks: s.clicks,
      })),
    }
  } else if (exp.primaryMetric === 'cvr') {
    const cmp = compareProportions(
      { successes: armStats[0].conversions, trials: armStats[0].clicks },
      { successes: armStats[1].conversions, trials: armStats[1].clicks }
    )
    result = {
      ...result,
      ...cmp,
      winner: cmp.significant ? (cmp.z > 0 ? armStats[1].arm.name : armStats[0].arm.name) : null,
      arms: armStats.map((s) => ({
        name: s.arm.name,
        clicks: s.clicks,
        conversions: s.conversions,
      })),
    }
  } else {
    result = { ...result, note: `Significance test not implemented for ${exp.primaryMetric}` }
  }

  const updated = await prisma.experiment.update({
    where: { id: exp.id },
    data: { status: 'completed', result: JSON.stringify(result) },
  })
  return NextResponse.json({ ok: true, experiment: updated, result })
}
