import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { DecisionsClient } from './client'

export const dynamic = 'force-dynamic'

const VALID_STATUS = new Set([
  'pending',
  'approved',
  'rejected',
  'executing',
  'executed',
  'failed',
  'rolled_back',
  'skipped',
])
const VALID_SEVERITY = new Set(['info', 'opportunity', 'warning', 'alert'])

export default async function DecisionsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')
  const sp = await props.searchParams
  const statusParam = typeof sp.status === 'string' && VALID_STATUS.has(sp.status) ? sp.status : null
  const severityParam =
    typeof sp.severity === 'string' && VALID_SEVERITY.has(sp.severity) ? sp.severity : null
  const campaignParam =
    typeof sp.campaignId === 'string' && sp.campaignId.length > 0 ? sp.campaignId : null
  const sinceParam = typeof sp.since === 'string' ? new Date(sp.since) : null
  const untilParam = typeof sp.until === 'string' ? new Date(sp.until) : null

  const where: Record<string, unknown> = { orgId: ctx.org.id }
  if (statusParam) where.status = statusParam
  if (severityParam) where.severity = severityParam
  if (campaignParam) {
    where.steps = {
      some: { toolInput: { contains: `"campaignId":"${campaignParam}"` } },
    }
  }
  const dateRange: Record<string, Date> = {}
  if (sinceParam && !Number.isNaN(sinceParam.getTime())) dateRange.gte = sinceParam
  if (untilParam && !Number.isNaN(untilParam.getTime())) dateRange.lte = untilParam
  if (Object.keys(dateRange).length > 0) where.createdAt = dateRange

  const [config, decisions] = await Promise.all([
    prisma.agentConfig.findUnique({ where: { orgId: ctx.org.id } }),
    prisma.decision.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        steps: { orderBy: { stepIndex: 'asc' } },
        outcome: true,
        approval: true,
      },
    }),
  ])

  return (
    <DecisionsClient
      role={ctx.role}
      filter={{
        status: statusParam,
        severity: severityParam,
        campaignId: campaignParam,
        since: sinceParam && !Number.isNaN(sinceParam.getTime()) ? sinceParam.toISOString().slice(0, 10) : null,
        until: untilParam && !Number.isNaN(untilParam.getTime()) ? untilParam.toISOString().slice(0, 10) : null,
      }}
      config={{
        enabled: config?.enabled ?? false,
        mode: config?.mode ?? 'shadow',
        killSwitch: config?.killSwitch ?? false,
        killSwitchReason: config?.killSwitchReason ?? null,
        monthlyLlmBudgetUsd: config?.monthlyLlmBudgetUsd ?? 50,
        monthlyLlmSpentUsd: config?.monthlyLlmSpentUsd ?? 0,
      }}
      decisions={decisions.map((d) => ({
        id: d.id,
        rationale: d.rationale,
        severity: d.severity,
        mode: d.mode,
        status: d.status,
        requiresApproval: d.requiresApproval,
        createdAt: d.createdAt.toISOString(),
        executedAt: d.executedAt?.toISOString() ?? null,
        llmCostUsd: d.llmCostUsd ?? 0,
        llmInputTokens: d.llmInputTokens ?? 0,
        llmOutputTokens: d.llmOutputTokens ?? 0,
        promptVersion: d.promptVersion ?? null,
        outcomeClass: d.outcome?.classification ?? null,
        outcomeDelta: d.outcome?.delta ?? null,
        triggerType: d.triggerType,
        steps: d.steps.map((s) => ({
          id: s.id,
          toolName: s.toolName,
          status: s.status,
          input: s.toolInput,
          output: s.toolOutput,
          guardrailReport: s.guardrailReport,
          reversible: s.reversible,
        })),
      }))}
    />
  )
}
