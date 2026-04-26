import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { completeJSON, isLLMConfigured } from '@/lib/llm'
import { renderPrompt } from '@/lib/agent/prompts/loader'
import { toolCatalogForPrompt, getTool } from '@/lib/agent/tools'

/**
 * POST /api/agent/backtest
 *  body: { promptVersionId: string; sinceHours?: number; limit?: number }
 *
 * Replays the last N Decisions' perceiveContext through a different prompt
 * version and returns the diff between the original decisions and the new
 * proposals — without executing anything.
 *
 * Use this to compare a candidate prompt vs the deployed one before promoting.
 */
export async function POST(req: NextRequest) {
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
  if (!isLLMConfigured()) {
    return NextResponse.json({ error: 'LLM not configured' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  if (!body.promptVersionId || typeof body.promptVersionId !== 'string') {
    return NextResponse.json({ error: 'promptVersionId required' }, { status: 400 })
  }
  const sinceHours = Number(body.sinceHours) > 0 ? Number(body.sinceHours) : 24 * 7
  const limit = Math.min(Number(body.limit) || 20, 50)

  const prompt = await prisma.promptVersion.findUnique({ where: { id: body.promptVersionId } })
  if (!prompt) return NextResponse.json({ error: 'promptVersion not found' }, { status: 404 })

  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000)
  const decisions = await prisma.decision.findMany({
    where: { orgId: org.id, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { steps: { orderBy: { stepIndex: 'asc' } } },
  })

  const cases: Array<{
    decisionId: string
    originalSteps: string[]
    candidateSteps: string[]
    diff: 'same_tools' | 'tool_set_changed' | 'no_action_now' | 'error'
    error?: string
  }> = []

  for (const d of decisions) {
    let snapshot: Record<string, unknown>
    try {
      snapshot = JSON.parse(d.perceiveContext || '{}')
    } catch {
      cases.push({ decisionId: d.id, originalSteps: [], candidateSteps: [], diff: 'error', error: 'unparseable perceiveContext' })
      continue
    }
    const rendered = renderPrompt(prompt.template, {
      TOOL_CATALOG_JSON: JSON.stringify(toolCatalogForPrompt(), null, 2),
      RECENT_DECISIONS_JSON: JSON.stringify(snapshot.recentDecisions || [], null, 2),
      GUARDRAIL_HINTS: Array.isArray(snapshot.guardrailHints)
        ? (snapshot.guardrailHints as string[]).join('\n') || '(none)'
        : '(none)',
      CAMPAIGNS_JSON: JSON.stringify(snapshot.campaigns || [], null, 2),
    })
    let candidate: { decisions?: Array<{ steps?: Array<{ tool?: string }> }> }
    try {
      candidate = await completeJSON<{
        decisions?: Array<{ steps?: Array<{ tool?: string }> }>
      }>(rendered, { maxTokens: 2048, temperature: 0 })
    } catch (err) {
      cases.push({
        decisionId: d.id,
        originalSteps: d.steps.map((s) => s.toolName),
        candidateSteps: [],
        diff: 'error',
        error: err instanceof Error ? err.message : 'llm error',
      })
      continue
    }
    const candidateSteps: string[] = []
    for (const cd of candidate.decisions || []) {
      for (const cs of cd.steps || []) {
        if (cs.tool && getTool(cs.tool)) candidateSteps.push(cs.tool)
      }
    }
    const originalSteps = d.steps.map((s) => s.toolName)
    let diff: 'same_tools' | 'tool_set_changed' | 'no_action_now'
    if (candidateSteps.length === 0 || (candidateSteps.length === 1 && candidateSteps[0] === 'noop')) {
      diff = 'no_action_now'
    } else {
      const a = [...originalSteps].sort().join(',')
      const b = [...candidateSteps].sort().join(',')
      diff = a === b ? 'same_tools' : 'tool_set_changed'
    }
    cases.push({ decisionId: d.id, originalSteps, candidateSteps, diff })
  }

  const summary = {
    same_tools: cases.filter((c) => c.diff === 'same_tools').length,
    tool_set_changed: cases.filter((c) => c.diff === 'tool_set_changed').length,
    no_action_now: cases.filter((c) => c.diff === 'no_action_now').length,
    error: cases.filter((c) => c.diff === 'error').length,
    total: cases.length,
  }

  return NextResponse.json({
    ok: true,
    promptVersion: { id: prompt.id, name: prompt.name, version: prompt.version },
    summary,
    cases,
  })
}
