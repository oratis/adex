import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * GET /api/agent/stats?days=7
 *
 * Aggregated org-level agent telemetry: counts by status / severity / mode,
 * verified outcome distribution, top tools, and total cost. Drives the
 * weekly digest and the dashboard cards.
 */
export async function GET(req: NextRequest) {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const days = Math.max(1, Math.min(Number(url.searchParams.get('days') || 7), 90))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [decisions, steps, outcomes, pendingApprovals, agentConfig, approvalLatencies] =
    await Promise.all([
      prisma.decision.findMany({
        where: { orgId: org.id, createdAt: { gte: since } },
        select: {
          status: true,
          severity: true,
          mode: true,
          triggerType: true,
          llmCostUsd: true,
          llmInputTokens: true,
          llmOutputTokens: true,
          createdAt: true,
        },
      }),
      prisma.decisionStep.findMany({
        where: { decision: { orgId: org.id, createdAt: { gte: since } } },
        select: { toolName: true, status: true },
      }),
      prisma.decisionOutcome.findMany({
        where: { decision: { orgId: org.id }, measuredAt: { gte: since } },
        select: { classification: true },
      }),
      prisma.pendingApproval.count({ where: { orgId: org.id } }),
      prisma.agentConfig.findUnique({ where: { orgId: org.id } }),
      // P14 work item 9: response time on resolved approvals in window.
      // Auto-rejected (rejectedReason='expired (72h)') is excluded so 72h
      // floor doesn't poison the median.
      prisma.decision.findMany({
        where: {
          orgId: org.id,
          requiresApproval: true,
          approvedAt: { not: null, gte: since },
          NOT: { rejectedReason: { contains: 'expired' } },
        },
        select: { createdAt: true, approvedAt: true, status: true },
      }),
    ])

  // Compute median + p95 of approval response time in minutes.
  const latencyMinutes: number[] = approvalLatencies
    .map((d) => {
      if (!d.approvedAt) return null
      return (d.approvedAt.getTime() - d.createdAt.getTime()) / 60_000
    })
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b)
  const pct = (arr: number[], p: number): number => {
    if (arr.length === 0) return 0
    const idx = Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))
    return arr[idx]
  }

  const tally = <T extends string>(arr: { [K in T]?: string | null }[], key: T) =>
    arr.reduce<Record<string, number>>((acc, row) => {
      const v = (row[key] as string) || 'unknown'
      acc[v] = (acc[v] || 0) + 1
      return acc
    }, {})

  return NextResponse.json({
    windowDays: days,
    enabled: agentConfig?.enabled ?? false,
    mode: agentConfig?.mode ?? 'shadow',
    killSwitch: agentConfig?.killSwitch ?? false,
    decisionsTotal: decisions.length,
    pendingApprovals,
    byStatus: tally(decisions, 'status'),
    bySeverity: tally(decisions, 'severity'),
    byMode: tally(decisions, 'mode'),
    byTrigger: tally(decisions, 'triggerType'),
    topTools: countTop(steps, 'toolName', 10),
    toolStatus: tally(steps, 'status'),
    outcomes: tally(outcomes, 'classification'),
    llmCostUsd: decisions.reduce((s, d) => s + (d.llmCostUsd || 0), 0),
    inputTokens: decisions.reduce((s, d) => s + (d.llmInputTokens || 0), 0),
    outputTokens: decisions.reduce((s, d) => s + (d.llmOutputTokens || 0), 0),
    approvalLatency: {
      sampleSize: latencyMinutes.length,
      medianMinutes: pct(latencyMinutes, 50),
      p95Minutes: pct(latencyMinutes, 95),
      maxMinutes: latencyMinutes.length ? latencyMinutes[latencyMinutes.length - 1] : 0,
    },
  })
}

function countTop<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
  limit: number
): Array<{ name: string; count: number }> {
  const map = new Map<string, number>()
  for (const r of rows) {
    const k = String(r[key] ?? 'unknown')
    map.set(k, (map.get(k) || 0) + 1)
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
