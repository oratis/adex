import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * GET /api/agent/prompt-runs?days=30
 *
 * Aggregated PromptRun metrics. PromptVersion is global, but we filter to
 * runs whose attributed Decision belongs to this org so the numbers reflect
 * what this org actually paid for.
 *
 * Returns per-version: runs, parsed%, avg latency, avg input/output tokens,
 * avg cost. Useful for spotting prompt-version regressions before promotion.
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

  // 1. Pull this org's decision IDs to scope PromptRun
  const decisions = await prisma.decision.findMany({
    where: { orgId: org.id, createdAt: { gte: since } },
    select: { id: true },
  })
  const decisionIds = decisions.map((d) => d.id)
  if (decisionIds.length === 0) {
    return NextResponse.json({ windowDays: days, perVersion: [], totalRuns: 0 })
  }

  const runs = await prisma.promptRun.findMany({
    where: { decisionId: { in: decisionIds } },
    include: { promptVersion: true },
  })

  type V = {
    promptVersionId: string
    name: string
    version: number
    isDefault: boolean
    runs: number
    parsedRate: number
    avgLatencyMs: number
    avgInputTokens: number
    avgOutputTokens: number
    avgCostUsd: number
    totalCostUsd: number
  }
  const map = new Map<string, V>()
  for (const r of runs) {
    const v = map.get(r.promptVersionId) || {
      promptVersionId: r.promptVersionId,
      name: r.promptVersion.name,
      version: r.promptVersion.version,
      isDefault: r.promptVersion.isDefault,
      runs: 0,
      parsedRate: 0,
      avgLatencyMs: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgCostUsd: 0,
      totalCostUsd: 0,
    }
    v.runs++
    v.parsedRate += r.parsed ? 1 : 0
    v.avgLatencyMs += r.latencyMs
    v.avgInputTokens += r.inputTokens
    v.avgOutputTokens += r.outputTokens
    v.avgCostUsd += r.costUsd || 0
    v.totalCostUsd += r.costUsd || 0
    map.set(r.promptVersionId, v)
  }
  const perVersion = Array.from(map.values()).map((v) => ({
    ...v,
    parsedRate: v.runs ? v.parsedRate / v.runs : 0,
    avgLatencyMs: v.runs ? Math.round(v.avgLatencyMs / v.runs) : 0,
    avgInputTokens: v.runs ? Math.round(v.avgInputTokens / v.runs) : 0,
    avgOutputTokens: v.runs ? Math.round(v.avgOutputTokens / v.runs) : 0,
    avgCostUsd: v.runs ? v.avgCostUsd / v.runs : 0,
  }))

  return NextResponse.json({
    windowDays: days,
    totalRuns: runs.length,
    perVersion: perVersion.sort((a, b) => b.runs - a.runs),
  })
}
