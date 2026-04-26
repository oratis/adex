import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * GET /api/agent/cost?month=YYYY-MM
 *
 * Aggregated PromptRun + Decision LLM cost for the org. Returns:
 *   - Per-PromptVersion cost & tokens
 *   - Per-day rollup
 *   - Org config: monthly cap + spend
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
  const monthParam = url.searchParams.get('month')
  const now = new Date()
  let monthStart: Date
  let monthEnd: Date
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number)
    monthStart = new Date(Date.UTC(y, m - 1, 1))
    monthEnd = new Date(Date.UTC(y, m, 1))
  } else {
    monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  }

  // PromptRun is global (not org-scoped) — but we filter to runs whose
  // attributed Decision belongs to this org.
  const runs = await prisma.promptRun.findMany({
    where: {
      createdAt: { gte: monthStart, lt: monthEnd },
      decisionId: { not: null },
    },
    include: { promptVersion: true },
  })
  const orgDecisionIds = new Set(
    (
      await prisma.decision.findMany({
        where: { orgId: org.id, createdAt: { gte: monthStart, lt: monthEnd } },
        select: { id: true, llmCostUsd: true, llmInputTokens: true, llmOutputTokens: true, createdAt: true, promptVersion: true },
      })
    ).map((d) => d.id)
  )
  const orgRuns = runs.filter((r) => r.decisionId && orgDecisionIds.has(r.decisionId))

  // Per-prompt-version aggregate
  type Bucket = {
    promptVersionId: string
    name: string
    version: number
    runs: number
    inputTokens: number
    outputTokens: number
    costUsd: number
    parsedRate: number
    avgLatencyMs: number
  }
  const byVersion = new Map<string, Bucket>()
  for (const r of orgRuns) {
    const key = r.promptVersionId
    const existing = byVersion.get(key) || {
      promptVersionId: key,
      name: r.promptVersion.name,
      version: r.promptVersion.version,
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      parsedRate: 0,
      avgLatencyMs: 0,
    }
    existing.runs++
    existing.inputTokens += r.inputTokens
    existing.outputTokens += r.outputTokens
    existing.costUsd += r.costUsd || 0
    existing.parsedRate += r.parsed ? 1 : 0
    existing.avgLatencyMs += r.latencyMs
    byVersion.set(key, existing)
  }
  const buckets = Array.from(byVersion.values()).map((b) => ({
    ...b,
    parsedRate: b.runs ? b.parsedRate / b.runs : 0,
    avgLatencyMs: b.runs ? Math.round(b.avgLatencyMs / b.runs) : 0,
  }))

  // Per-day rollup using Decision.llmCostUsd (covers disk-only prompts too).
  const decisions = await prisma.decision.findMany({
    where: { orgId: org.id, createdAt: { gte: monthStart, lt: monthEnd } },
    select: { llmCostUsd: true, llmInputTokens: true, llmOutputTokens: true, createdAt: true },
  })
  const perDay = new Map<string, { date: string; costUsd: number; runs: number }>()
  for (const d of decisions) {
    const day = d.createdAt.toISOString().slice(0, 10)
    const ex = perDay.get(day) || { date: day, costUsd: 0, runs: 0 }
    ex.costUsd += d.llmCostUsd || 0
    ex.runs++
    perDay.set(day, ex)
  }

  const cfg = await prisma.agentConfig.findUnique({ where: { orgId: org.id } })

  return NextResponse.json({
    month: monthStart.toISOString().slice(0, 7),
    monthlyBudgetUsd: cfg?.monthlyLlmBudgetUsd ?? 50,
    monthlySpentUsd: cfg?.monthlyLlmSpentUsd ?? 0,
    decisionsThisMonth: decisions.length,
    totalCostUsd: decisions.reduce((s, d) => s + (d.llmCostUsd || 0), 0),
    totalInputTokens: decisions.reduce((s, d) => s + (d.llmInputTokens || 0), 0),
    totalOutputTokens: decisions.reduce((s, d) => s + (d.llmOutputTokens || 0), 0),
    perVersion: buckets.sort((a, b) => b.costUsd - a.costUsd),
    perDay: Array.from(perDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
  })
}
