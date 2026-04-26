import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { OnboardingClient } from './client'

export const dynamic = 'force-dynamic'

export default async function AgentOnboardingPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')

  const cfg =
    (await prisma.agentConfig.findUnique({ where: { orgId: ctx.org.id } })) ||
    (await prisma.agentConfig.create({
      data: { orgId: ctx.org.id, enabled: false, mode: 'shadow' },
    }))

  // Read decision counts to give the user a real "you've seen X agent runs"
  // signal — abstract progress indicators are unhelpful.
  const [shadowCount, approvalCount] = await Promise.all([
    cfg.shadowStartedAt
      ? prisma.decision.count({
          where: { orgId: ctx.org.id, mode: 'shadow', createdAt: { gte: cfg.shadowStartedAt } },
        })
      : Promise.resolve(0),
    cfg.approvalOnlyStartedAt
      ? prisma.decision.count({
          where: {
            orgId: ctx.org.id,
            mode: 'approval_only',
            createdAt: { gte: cfg.approvalOnlyStartedAt },
          },
        })
      : Promise.resolve(0),
  ])

  return (
    <OnboardingClient
      role={ctx.role}
      config={{
        enabled: cfg.enabled,
        mode: cfg.mode,
        autonomousAllowed: cfg.autonomousAllowed,
        autonomousAllowedAt: cfg.autonomousAllowedAt?.toISOString() || null,
        shadowStartedAt: cfg.shadowStartedAt?.toISOString() || null,
        approvalOnlyStartedAt: cfg.approvalOnlyStartedAt?.toISOString() || null,
        autonomousStartedAt: cfg.autonomousStartedAt?.toISOString() || null,
      }}
      counts={{ shadow: shadowCount, approval: approvalCount }}
    />
  )
}
