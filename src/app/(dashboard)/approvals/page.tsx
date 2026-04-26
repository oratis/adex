import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { ApprovalsClient } from './client'

export const dynamic = 'force-dynamic'

export default async function ApprovalsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')

  const approvals = await prisma.pendingApproval.findMany({
    where: { orgId: ctx.org.id, decision: { status: 'pending' } },
    orderBy: { createdAt: 'desc' },
    include: {
      decision: { include: { steps: { orderBy: { stepIndex: 'asc' } } } },
    },
  })

  return (
    <ApprovalsClient
      role={ctx.role}
      approvals={approvals.map((a) => ({
        id: a.id,
        decisionId: a.decisionId,
        expiresAt: a.expiresAt.toISOString(),
        createdAt: a.createdAt.toISOString(),
        decision: {
          rationale: a.decision.rationale,
          severity: a.decision.severity,
          steps: a.decision.steps.map((s) => ({
            id: s.id,
            toolName: s.toolName,
            input: s.toolInput,
            guardrailReport: s.guardrailReport,
          })),
        },
      }))}
    />
  )
}
