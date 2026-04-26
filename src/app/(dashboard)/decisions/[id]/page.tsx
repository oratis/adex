import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RollbackButton } from './rollback-button'

export const dynamic = 'force-dynamic'

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-gray-100 text-gray-700',
  opportunity: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  alert: 'bg-rose-100 text-rose-700',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  executed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  rejected: 'bg-gray-200 text-gray-700',
  rolled_back: 'bg-purple-100 text-purple-700',
  skipped: 'bg-gray-100 text-gray-600',
  executing: 'bg-blue-100 text-blue-700',
}

export default async function DecisionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')
  const { id } = await params

  const decision = await prisma.decision.findFirst({
    where: { id, orgId: ctx.org.id },
    include: {
      steps: { orderBy: { stepIndex: 'asc' } },
      outcome: true,
      approval: true,
    },
  })
  if (!decision) notFound()

  const isAdmin = ctx.role === 'owner' || ctx.role === 'admin'
  const hasReversibleSteps = decision.steps.some((s) => s.reversible)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/decisions" className="text-sm text-blue-600 hover:underline">
          ← All decisions
        </Link>
        <h1 className="text-2xl font-bold mt-2">Decision detail</h1>
        <p className="font-mono text-xs text-gray-500 mt-1">{decision.id}</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={SEVERITY_COLORS[decision.severity] || ''}>{decision.severity}</Badge>
            <Badge className={STATUS_COLORS[decision.status] || ''}>{decision.status}</Badge>
            <Badge className="bg-gray-100 text-gray-700">{decision.mode}</Badge>
            <Badge className="bg-gray-100 text-gray-700">trigger: {decision.triggerType}</Badge>
            {decision.outcome && (
              <Badge
                className={
                  decision.outcome.classification === 'success'
                    ? 'bg-emerald-100 text-emerald-700'
                    : decision.outcome.classification === 'regression'
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-gray-100 text-gray-700'
                }
              >
                outcome: {decision.outcome.classification}
              </Badge>
            )}
          </div>
          <p className="text-sm">{decision.rationale}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-gray-500 uppercase">Created</div>
              <div>{decision.createdAt.toLocaleString()}</div>
            </div>
            {decision.executedAt && (
              <div>
                <div className="text-gray-500 uppercase">Executed</div>
                <div>{decision.executedAt.toLocaleString()}</div>
              </div>
            )}
            <div>
              <div className="text-gray-500 uppercase">Tokens</div>
              <div>
                {decision.llmInputTokens ?? 0} in / {decision.llmOutputTokens ?? 0} out
              </div>
            </div>
            <div>
              <div className="text-gray-500 uppercase">Cost</div>
              <div>${(decision.llmCostUsd ?? 0).toFixed(4)}</div>
            </div>
            {decision.promptVersion && (
              <div className="col-span-2">
                <div className="text-gray-500 uppercase">Prompt version</div>
                <div className="font-mono text-[10px] break-all">{decision.promptVersion}</div>
              </div>
            )}
            {decision.rejectedReason && (
              <div className="col-span-2">
                <div className="text-gray-500 uppercase">Rejected because</div>
                <div>{decision.rejectedReason}</div>
              </div>
            )}
          </div>

          {isAdmin && decision.status === 'executed' && hasReversibleSteps && (
            <RollbackButton id={decision.id} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {decision.steps.map((s) => (
            <div key={s.id} className="border rounded p-3 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <Badge>{s.toolName}</Badge>
                <Badge className={STATUS_COLORS[s.status] || ''}>{s.status}</Badge>
                {s.reversible && (
                  <Badge className="bg-blue-50 text-blue-700">reversible</Badge>
                )}
                {s.rollbackOf && (
                  <Badge className="bg-purple-50 text-purple-700">
                    rollback of {s.rollbackOf.slice(0, 8)}
                  </Badge>
                )}
                <span className="text-gray-500 ml-auto">step #{s.stepIndex}</span>
              </div>
              <details>
                <summary className="cursor-pointer text-gray-600">Tool input</summary>
                <pre className="font-mono text-[10px] whitespace-pre-wrap break-all bg-gray-50 p-2 rounded mt-1">
                  {s.toolInput}
                </pre>
              </details>
              {s.toolOutput && (
                <details>
                  <summary className="cursor-pointer text-gray-600">Tool output</summary>
                  <pre className="font-mono text-[10px] whitespace-pre-wrap break-all bg-gray-50 p-2 rounded mt-1">
                    {s.toolOutput}
                  </pre>
                </details>
              )}
              {s.guardrailReport && (
                <details>
                  <summary className="cursor-pointer text-gray-600">Guardrail report</summary>
                  <pre className="font-mono text-[10px] whitespace-pre-wrap break-all bg-gray-50 p-2 rounded mt-1">
                    {s.guardrailReport}
                  </pre>
                </details>
              )}
              {s.platformResponse && (
                <details>
                  <summary className="cursor-pointer text-gray-600">Platform response</summary>
                  <pre className="font-mono text-[10px] whitespace-pre-wrap break-all bg-gray-50 p-2 rounded mt-1">
                    {s.platformResponse}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {decision.outcome && (
        <Card>
          <CardHeader>
            <CardTitle>Outcome</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-gray-500 uppercase">Window</div>
                <div>{decision.outcome.windowHours}h</div>
              </div>
              <div>
                <div className="text-gray-500 uppercase">Measured at</div>
                <div>{decision.outcome.measuredAt.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-gray-500 uppercase">Classification</div>
                <div>{decision.outcome.classification}</div>
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-gray-600">Before / after / delta</summary>
              <div className="mt-1 grid grid-cols-3 gap-2">
                <pre className="font-mono whitespace-pre-wrap break-all bg-gray-50 p-2 rounded">
                  before: {decision.outcome.metricsBefore}
                </pre>
                <pre className="font-mono whitespace-pre-wrap break-all bg-gray-50 p-2 rounded">
                  after: {decision.outcome.metricsAfter}
                </pre>
                <pre className="font-mono whitespace-pre-wrap break-all bg-gray-50 p-2 rounded">
                  delta: {decision.outcome.delta}
                </pre>
              </div>
            </details>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Perceive context (snapshot fed to plan)</CardTitle>
        </CardHeader>
        <CardContent>
          <details>
            <summary className="cursor-pointer text-xs text-gray-600">Show JSON</summary>
            <pre className="font-mono text-[10px] whitespace-pre-wrap break-all bg-gray-50 p-2 rounded mt-2 max-h-96 overflow-auto">
              {decision.perceiveContext || '(empty)'}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}
