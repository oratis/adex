import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * POST /api/setup/demo-data
 *
 * Seed 3 demo campaigns + 7 days of fake Report rows so first-time users
 * can explore the dashboard / advisor / agent flows without connecting a
 * real platform.
 *
 * Idempotent — if any campaign already exists in the org, refuses (we
 * don't want to pollute real data). Demo entities are tagged with
 * `name` prefix "[Demo]" so users can spot + delete them later.
 *
 * Permanent campaigns: rows live in the user's actual workspace; manual
 * cleanup via /campaigns delete or `DELETE FROM "Campaign" WHERE name LIKE '[Demo]%'`.
 */
export async function POST(req: NextRequest) {
  let user, org, role
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
    role = ctx.role
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  void req
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Owner/admin only' }, { status: 403 })
  }

  const existing = await prisma.campaign.count({ where: { orgId: org.id } })
  if (existing > 0) {
    return NextResponse.json(
      {
        error: `Workspace already has ${existing} campaign(s). Refusing to seed demo data on top of real data — delete real campaigns first or use a fresh workspace.`,
      },
      { status: 400 }
    )
  }

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const seeds = [
    {
      name: '[Demo] Summer fashion · US',
      platform: 'google',
      objective: 'consideration',
      countries: ['US'],
      budget: 80,
      profile: 'winner',
    },
    {
      name: '[Demo] Mobile game install · SEA',
      platform: 'meta',
      objective: 'conversion',
      countries: ['SG', 'TH', 'VN'],
      budget: 50,
      profile: 'mediocre',
    },
    {
      name: '[Demo] Skincare retargeting · JP',
      platform: 'tiktok',
      objective: 'conversion',
      countries: ['JP'],
      budget: 100,
      profile: 'losing',
    },
  ] as const

  type Profile = 'winner' | 'mediocre' | 'losing'
  function metricsFor(p: Profile, dayIndex: number) {
    // Inject some daily noise so the dashboard chart isn't dead flat.
    const noise = 1 + (Math.sin(dayIndex * 1.7) * 0.15)
    if (p === 'winner') {
      return {
        impressions: Math.round(28000 * noise),
        clicks: Math.round(1100 * noise),
        conversions: Math.round(48 * noise),
        spend: Math.round(75 * noise * 100) / 100,
        revenue: Math.round(360 * noise * 100) / 100, // ROAS ~4.8
      }
    }
    if (p === 'mediocre') {
      return {
        impressions: Math.round(15000 * noise),
        clicks: Math.round(280 * noise),
        conversions: Math.round(8 * noise),
        spend: Math.round(48 * noise * 100) / 100,
        revenue: Math.round(54 * noise * 100) / 100, // ROAS ~1.1
      }
    }
    return {
      impressions: Math.round(40000 * noise),
      clicks: Math.round(900 * noise),
      conversions: Math.round(6 * noise),
      spend: Math.round(95 * noise * 100) / 100,
      revenue: Math.round(28 * noise * 100) / 100, // ROAS ~0.3
    }
  }

  const created: { id: string; name: string }[] = []
  for (const seed of seeds) {
    const c = await prisma.campaign.create({
      data: {
        orgId: org.id,
        userId: user.id,
        name: seed.name,
        platform: seed.platform,
        status: 'active',
        desiredStatus: 'active',
        syncedStatus: 'active',
        managedByAgent: true,
        objective: seed.objective,
        targetCountries: JSON.stringify(seed.countries),
        ageMin: 18,
        ageMax: 55,
        gender: 'all',
        startDate: new Date(today.getTime() - 14 * 86_400_000),
        budgets: {
          create: {
            orgId: org.id,
            userId: user.id,
            type: 'daily',
            amount: seed.budget,
            currency: 'USD',
          },
        },
      },
    })
    created.push({ id: c.id, name: c.name })

    // 7 days of campaign-level Report rows
    for (let d = 0; d < 7; d++) {
      const date = new Date(today.getTime() - d * 86_400_000)
      const m = metricsFor(seed.profile, d)
      const ctr = m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0
      const cpc = m.clicks > 0 ? m.spend / m.clicks : 0
      const cpa = m.conversions > 0 ? m.spend / m.conversions : 0
      const roas = m.spend > 0 ? m.revenue / m.spend : 0
      await prisma.report.create({
        data: {
          orgId: org.id,
          userId: user.id,
          platform: seed.platform,
          level: 'account', // dashboard reads account-level
          date,
          impressions: m.impressions,
          clicks: m.clicks,
          conversions: m.conversions,
          spend: m.spend,
          revenue: m.revenue,
          ctr,
          cpc,
          cpa,
          roas,
          rawData: JSON.stringify({ demo: true, profile: seed.profile, day: d }),
        },
      })
    }
  }

  // Seed a handful of historical Decisions + Outcomes so /decisions and
  // /agent-stats look populated immediately. mode=shadow makes it clear
  // these are demo records, not real agent actions.
  const now = Date.now()
  const demoDecisions = [
    {
      severity: 'opportunity',
      mode: 'shadow',
      status: 'skipped',
      rationale: '[Demo] Healthy 7d ROAS 4.8× on Summer fashion · US — no action needed.',
      tool: 'noop',
      campaignId: created[0]?.id,
      hoursAgo: 1,
      classification: null as string | null,
    },
    {
      severity: 'alert',
      mode: 'shadow',
      status: 'skipped',
      rationale:
        '[Demo] Skincare retargeting · JP burning at ROAS 0.3×. In shadow mode — would have paused.',
      tool: 'pause_campaign',
      campaignId: created[2]?.id,
      hoursAgo: 4,
      classification: null,
    },
    {
      severity: 'warning',
      mode: 'approval_only',
      status: 'executed',
      rationale:
        '[Demo] Mobile game install · SEA CTR dropped to 1.8%; reduced daily budget by 20% pending review.',
      tool: 'adjust_daily_budget',
      campaignId: created[1]?.id,
      hoursAgo: 30,
      classification: 'success',
    },
  ]

  let decisionsCreated = 0
  for (const d of demoDecisions) {
    if (!d.campaignId) continue
    const createdAt = new Date(now - d.hoursAgo * 3600_000)
    const decision = await prisma.decision.create({
      data: {
        orgId: org.id,
        triggerType: 'cron',
        perceiveContext: '[Demo] Synthetic perceive context — see /api/setup/demo-data',
        promptVersion: 'disk:agent.plan@v1',
        rationale: d.rationale,
        severity: d.severity,
        mode: d.mode,
        status: d.status,
        requiresApproval: false,
        createdAt,
        executedAt: d.status === 'executed' ? createdAt : null,
        llmCostUsd: 0.012,
        llmInputTokens: 2400,
        llmOutputTokens: 180,
      },
    })
    await prisma.decisionStep.create({
      data: {
        decisionId: decision.id,
        stepIndex: 0,
        toolName: d.tool,
        toolInput: JSON.stringify({ campaignId: d.campaignId, reason: '[Demo] synthetic step' }),
        status: d.status === 'executed' ? 'executed' : 'skipped',
        reversible: true,
        executedAt: d.status === 'executed' ? createdAt : null,
      },
    })
    if (d.classification) {
      await prisma.decisionOutcome.create({
        data: {
          decisionId: decision.id,
          measuredAt: new Date(createdAt.getTime() + 24 * 3600_000),
          windowHours: 24,
          metricsBefore: JSON.stringify({ spend: 50, revenue: 60, roas: 1.2 }),
          metricsAfter: JSON.stringify({ spend: 40, revenue: 65, roas: 1.6 }),
          delta: JSON.stringify({ spend: -10, revenue: 5, roas: 0.4 }),
          classification: d.classification,
          notes: '[Demo] synthetic outcome',
        },
      })
    }
    decisionsCreated++
  }

  return NextResponse.json({
    ok: true,
    campaignsCreated: created.length,
    campaigns: created,
    decisionsCreated,
    note: 'Demo data prefixed with "[Demo]". Delete via /campaigns + /decisions when done.',
  })
}
