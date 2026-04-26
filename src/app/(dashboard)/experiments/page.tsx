import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { ExperimentsClient } from './client'

export const dynamic = 'force-dynamic'

export default async function ExperimentsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')

  const experiments = await prisma.experiment.findMany({
    where: { orgId: ctx.org.id },
    orderBy: { startedAt: 'desc' },
    include: { arms: true },
  })

  return (
    <ExperimentsClient
      role={ctx.role}
      experiments={experiments.map((e) => ({
        id: e.id,
        campaignLinkId: e.campaignLinkId,
        hypothesis: e.hypothesis,
        status: e.status,
        startedAt: e.startedAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        primaryMetric: e.primaryMetric,
        minSampleSize: e.minSampleSize,
        result: e.result,
        arms: e.arms.map((a) => ({
          name: a.name,
          adLinkId: a.adLinkId,
          trafficShare: a.trafficShare,
        })),
      }))}
    />
  )
}
