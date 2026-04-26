import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { OrphansClient } from './client'

export const dynamic = 'force-dynamic'

export default async function OrphansPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')

  const links = await prisma.platformLink.findMany({
    where: { orgId: ctx.org.id, entityType: 'campaign', status: 'active' },
    orderBy: { lastSyncedAt: 'desc' },
  })
  // "orphan" = the link's localEntityId equals platformEntityId, meaning we
  // discovered the campaign via snapshot but never bound it to a local row.
  const orphans = links.filter((l) => l.localEntityId === l.platformEntityId)

  return (
    <OrphansClient
      role={ctx.role}
      orphans={orphans.map((o) => ({
        id: o.id,
        platform: o.platform,
        accountId: o.accountId,
        platformEntityId: o.platformEntityId,
        metadata: o.metadata,
        lastSyncedAt: o.lastSyncedAt?.toISOString() || null,
      }))}
    />
  )
}
