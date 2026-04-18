import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { completeJSON, isLLMConfigured } from '@/lib/llm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

type AppliableAction =
  | { type: 'pause_campaign'; campaignId: string }
  | { type: 'resume_campaign'; campaignId: string }

type Advice = {
  title: string
  description: string
  severity: 'info' | 'warning' | 'opportunity' | 'alert'
  recommendedAction?: string
  action?: AppliableAction
}

type AdvisorResponse = {
  advice: Advice[]
  source: 'llm' | 'rules'
  model?: string
}

// Fallback rule-based advice so the endpoint always returns something useful.
function ruleBasedAdvice(params: {
  reportsByPlatform: Record<string, { spend: number; revenue: number; clicks: number; impressions: number; conversions: number }>
  campaigns: Array<{ name: string; status: string; platform: string }>
}): Advice[] {
  const out: Advice[] = []
  const platforms = Object.entries(params.reportsByPlatform)

  for (const [platform, m] of platforms) {
    const roas = m.spend > 0 ? m.revenue / m.spend : 0
    const ctr = m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0
    const cpa = m.conversions > 0 ? m.spend / m.conversions : 0

    if (m.spend > 0 && roas < 1) {
      out.push({
        title: `Low ROAS on ${platform}`,
        description: `ROAS is ${roas.toFixed(2)}x across ${platform}. Consider pausing or re-targeting underperforming campaigns.`,
        severity: 'alert',
        recommendedAction: 'Pause the worst-performing campaign on this platform.',
      })
    } else if (m.spend > 0 && roas > 3) {
      out.push({
        title: `Scale opportunity on ${platform}`,
        description: `ROAS of ${roas.toFixed(2)}x suggests room to increase budget.`,
        severity: 'opportunity',
        recommendedAction: 'Increase daily budget by 20–30% on the top ROAS campaign.',
      })
    }

    if (m.impressions > 1000 && ctr < 1) {
      out.push({
        title: `Low CTR on ${platform}`,
        description: `Only ${ctr.toFixed(2)}% CTR. Creative or targeting likely needs refresh.`,
        severity: 'warning',
        recommendedAction: 'Generate 3 new creative variants and A/B test.',
      })
    }

    if (cpa > 50) {
      out.push({
        title: `High CPA on ${platform}`,
        description: `Cost per conversion is $${cpa.toFixed(2)}.`,
        severity: 'warning',
      })
    }
  }

  const draft = params.campaigns.filter((c) => c.status === 'draft')
  if (draft.length > 0) {
    out.push({
      title: `${draft.length} draft campaign${draft.length === 1 ? '' : 's'} waiting`,
      description: `Launch them to start pulling data: ${draft.slice(0, 3).map((c) => c.name).join(', ')}${draft.length > 3 ? '…' : ''}.`,
      severity: 'info',
    })
  }

  if (params.campaigns.filter((c) => c.status === 'active').length === 0) {
    out.push({
      title: 'No active campaigns',
      description: 'Create and launch a campaign to start driving performance.',
      severity: 'info',
    })
  }

  if (out.length === 0) {
    out.push({
      title: 'Everything looks healthy',
      description: 'No immediate issues detected from the last 7 days of data.',
      severity: 'info',
    })
  }

  return out
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let user, org
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 60 calls / hour / user — generous but keeps LLM spend bounded
  const rl = checkRateLimit(req, {
    key: 'advisor',
    limit: 60,
    windowMs: 60 * 60_000,
    identity: user.id,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const [reports, campaigns] = await Promise.all([
      prisma.report.findMany({
        where: { orgId: org.id, date: { gte: since } },
        orderBy: { date: 'asc' },
      }),
      prisma.campaign.findMany({
        where: { orgId: org.id },
        include: { budgets: true },
      }),
    ])

    // Aggregate by platform
    const reportsByPlatform: Record<
      string,
      { spend: number; revenue: number; clicks: number; impressions: number; conversions: number }
    > = {}
    for (const r of reports) {
      if (!reportsByPlatform[r.platform]) {
        reportsByPlatform[r.platform] = {
          spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0,
        }
      }
      const p = reportsByPlatform[r.platform]
      p.spend += r.spend
      p.revenue += r.revenue
      p.clicks += r.clicks
      p.impressions += r.impressions
      p.conversions += r.conversions
    }

    // If LLM is configured, ask for tailored advice
    if (isLLMConfigured() && reports.length > 0) {
      try {
        const summary = {
          days: 7,
          platforms: reportsByPlatform,
          campaigns: campaigns.map((c) => ({
            id: c.id,
            name: c.name,
            platform: c.platform,
            status: c.status,
            budget: c.budgets?.[0]?.amount || null,
            spent: c.budgets?.[0]?.spent || null,
          })),
        }

        const prompt = `You are a senior paid-ads strategist. Review this advertiser's last 7 days of performance and produce 3–6 prioritized recommendations.

For each recommendation:
- title: short actionable phrase
- description: 1-2 sentences explaining why, citing numbers from the data
- severity: one of alert, warning, opportunity, info
- recommendedAction: human-readable next step (optional)
- action (optional): a one-click automated action, ONLY for low-risk reversible ops. Must be one of:
  { "type": "pause_campaign", "campaignId": "<id>" } — only if the campaign.status is "active" AND there's a clear case to pause (e.g. ROAS below 0.5)
  { "type": "resume_campaign", "campaignId": "<id>" } — only if status is "paused" AND metrics suggest resuming
- DO NOT output an action unless you're confident. Default to recommendedAction text instead.
- NEVER suggest launching new campaigns or changing budgets as an action (those still require human approval).

Performance summary (JSON):
${JSON.stringify(summary, null, 2)}

Return JSON:
{
  "advice": [
    {
      "title": "...",
      "description": "...",
      "severity": "alert|warning|opportunity|info",
      "recommendedAction": "...",
      "action": { "type": "pause_campaign", "campaignId": "..." }
    }
  ]
}`

        const result = await completeJSON<{ advice: Advice[] }>(prompt, {
          maxTokens: 1500,
          temperature: 0.3,
        })

        if (Array.isArray(result.advice) && result.advice.length > 0) {
          // Validate actions: campaignId must belong to the current org,
          // and the type must be one we actually support.
          const validCampaignIds = new Set(campaigns.map((c) => c.id))
          const sanitized = result.advice.map((a) => {
            if (!a.action) return a
            const t = a.action.type
            if (
              (t !== 'pause_campaign' && t !== 'resume_campaign') ||
              !validCampaignIds.has(a.action.campaignId)
            ) {
              // Drop the action but keep the advice text
              const { action: _drop, ...rest } = a
              return rest
            }
            return a
          })
          const resp: AdvisorResponse = {
            advice: sanitized,
            source: 'llm',
            model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
          }
          return NextResponse.json(resp)
        }
      } catch (err) {
        console.error('LLM advisor failed, falling back to rules:', err)
      }
    }

    const resp: AdvisorResponse = {
      advice: ruleBasedAdvice({
        reportsByPlatform,
        campaigns: campaigns.map((c) => ({
          name: c.name,
          status: c.status,
          platform: c.platform,
        })),
      }),
      source: 'rules',
    }
    return NextResponse.json(resp)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Advisor failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
