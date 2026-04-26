import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * GET /api/agent/prompt-outcomes?days=30
 *
 * Per-PromptVersion outcome correlation. Joins PromptRun.decisionId →
 * Decision.outcome. Returns:
 *   - runs                  : total runs that produced a Decision
 *   - decisionsExecuted     : Decisions that actually executed (vs skipped/rejected)
 *   - withOutcome           : Decisions whose 24h verify window has been measured
 *   - successRate           : success / withOutcome
 *   - regressionRate        : regression / withOutcome
 *   - avgCostUsd            : per-run prompt cost
 *
 * Use this to compare a candidate prompt vs the current default *on outcomes*
 * before promoting. Pairs with /api/agent/backtest (which compares decisions
 * but doesn't cover real-world outcome).
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
  const days = Math.max(1, Math.min(Number(url.searchParams.get('days') || 30), 90))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Pull this org's decisions in window with outcomes (left-joined).
  const decisions = await prisma.decision.findMany({
    where: { orgId: org.id, createdAt: { gte: since } },
    select: {
      id: true,
      promptVersion: true,
      status: true,
      outcome: { select: { classification: true } },
    },
  })
  if (decisions.length === 0) {
    return NextResponse.json({ windowDays: days, perVersion: [] })
  }

  // Look up PromptVersion metadata for any IDs that are real DB rows.
  const promptVersionIds = Array.from(
    new Set(
      decisions
        .map((d) => d.promptVersion)
        .filter((v): v is string => typeof v === 'string' && !v.startsWith('disk:') && !v.startsWith('system:'))
    )
  )
  const versions = promptVersionIds.length
    ? await prisma.promptVersion.findMany({
        where: { id: { in: promptVersionIds } },
        select: { id: true, name: true, version: true, isDefault: true, isExperimental: true, experimentalSharePct: true, model: true },
      })
    : []
  const versionMap = new Map(versions.map((v) => [v.id, v]))

  type Bucket = {
    promptVersionId: string
    name: string
    version: number | null
    isDefault: boolean
    isExperimental: boolean
    sharePct: number
    decisions: number
    decisionsExecuted: number
    withOutcome: number
    success: number
    neutral: number
    regression: number
    falsePositive: number
  }
  const map = new Map<string, Bucket>()
  for (const d of decisions) {
    const key = d.promptVersion || 'unknown'
    const meta = versionMap.get(key)
    const b = map.get(key) || {
      promptVersionId: key,
      name: meta?.name || (key.startsWith('disk:') ? key : 'unknown'),
      version: meta?.version ?? null,
      isDefault: meta?.isDefault ?? key.startsWith('disk:'),
      isExperimental: meta?.isExperimental ?? false,
      sharePct: meta?.experimentalSharePct ?? 0,
      decisions: 0,
      decisionsExecuted: 0,
      withOutcome: 0,
      success: 0,
      neutral: 0,
      regression: 0,
      falsePositive: 0,
    }
    b.decisions++
    if (d.status === 'executed') b.decisionsExecuted++
    if (d.outcome) {
      b.withOutcome++
      switch (d.outcome.classification) {
        case 'success':
          b.success++
          break
        case 'neutral':
          b.neutral++
          break
        case 'regression':
          b.regression++
          break
        case 'false_positive':
          b.falsePositive++
          break
      }
    }
    map.set(key, b)
  }

  const perVersion = Array.from(map.values()).map((b) => ({
    ...b,
    successRate: b.withOutcome ? b.success / b.withOutcome : 0,
    regressionRate: b.withOutcome ? b.regression / b.withOutcome : 0,
  }))

  // Pull avg cost per version from PromptRun for the same window.
  const runs = await prisma.promptRun.findMany({
    where: {
      promptVersionId: { in: promptVersionIds },
      createdAt: { gte: since },
    },
    select: { promptVersionId: true, costUsd: true, latencyMs: true, parsed: true },
  })
  const costMap = new Map<string, { runs: number; cost: number; latency: number; parsed: number }>()
  for (const r of runs) {
    const c = costMap.get(r.promptVersionId) || { runs: 0, cost: 0, latency: 0, parsed: 0 }
    c.runs++
    c.cost += r.costUsd || 0
    c.latency += r.latencyMs
    c.parsed += r.parsed ? 1 : 0
    costMap.set(r.promptVersionId, c)
  }
  const enriched = perVersion.map((b) => {
    const c = costMap.get(b.promptVersionId)
    return {
      ...b,
      avgCostUsd: c && c.runs ? c.cost / c.runs : 0,
      avgLatencyMs: c && c.runs ? Math.round(c.latency / c.runs) : 0,
      parsedRate: c && c.runs ? c.parsed / c.runs : 0,
    }
  })

  return NextResponse.json({
    windowDays: days,
    totalDecisions: decisions.length,
    perVersion: enriched.sort((a, b) => b.decisions - a.decisions),
  })
}
