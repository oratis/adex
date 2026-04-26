import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { AuditClient } from './client'

export const dynamic = 'force-dynamic'

const VALID_ACTIONS = new Set([
  'campaign.create', 'campaign.update', 'campaign.delete', 'campaign.launch',
  'campaign.pause', 'campaign.resume', 'creative.create', 'creative.delete',
  'creative.attach', 'budget.create', 'budget.update', 'budget.delete',
  'platform.connect', 'platform.disconnect', 'member.invite',
  'member.invite_revoke', 'member.invite_accept', 'member.role_change',
  'member.remove', 'org.create', 'org.switch', 'advisor.apply', 'cron.daily',
])

export default async function AuditPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')
  const sp = await props.searchParams
  const actionFilter =
    typeof sp.action === 'string' && VALID_ACTIONS.has(sp.action) ? sp.action : null
  const targetType = typeof sp.targetType === 'string' ? sp.targetType : null

  const where: Record<string, unknown> = { orgId: ctx.org.id }
  if (actionFilter) where.action = actionFilter
  if (targetType) where.targetType = targetType

  const events = await prisma.auditEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return (
    <AuditClient
      role={ctx.role}
      filter={{ action: actionFilter, targetType }}
      events={events.map((e) => ({
        id: e.id,
        action: e.action,
        userId: e.userId,
        targetType: e.targetType,
        targetId: e.targetId,
        metadata: e.metadata,
        ipAddress: e.ipAddress,
        createdAt: e.createdAt.toISOString(),
      }))}
    />
  )
}
