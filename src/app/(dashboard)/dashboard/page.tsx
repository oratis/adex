import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import DashboardClient from './_client'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')

  // Brand-new users with no platforms AND no campaigns get bounced to the
  // 4-step setup wizard. They can still skip back to the empty dashboard
  // from there if they want.
  const [platforms, campaigns] = await Promise.all([
    prisma.platformAuth.count({ where: { orgId: ctx.org.id, isActive: true } }),
    prisma.campaign.count({ where: { orgId: ctx.org.id } }),
  ])
  if (platforms === 0 && campaigns === 0) redirect('/setup')

  return <DashboardClient />
}
