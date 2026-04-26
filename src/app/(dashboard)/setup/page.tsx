import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { SetupWizard } from './client'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')

  const [authsCount, campaignsCount, agentCfg] = await Promise.all([
    prisma.platformAuth.count({ where: { orgId: ctx.org.id, isActive: true } }),
    prisma.campaign.count({ where: { orgId: ctx.org.id } }),
    prisma.agentConfig.findUnique({ where: { orgId: ctx.org.id } }),
  ])

  // Already set up? Skip the wizard.
  if (authsCount > 0 && campaignsCount > 0) redirect('/dashboard')

  return (
    <SetupWizard
      orgName={ctx.org.name}
      authsCount={authsCount}
      campaignsCount={campaignsCount}
      agentEnabled={agentCfg?.enabled ?? false}
    />
  )
}
