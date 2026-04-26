import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { GuardrailsClient } from './client'

export const dynamic = 'force-dynamic'

export default async function GuardrailsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')

  const rows = await prisma.guardrail.findMany({
    where: { orgId: ctx.org.id },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <GuardrailsClient
      role={ctx.role}
      initial={rows.map((r) => ({
        id: r.id,
        scope: r.scope,
        scopeId: r.scopeId,
        rule: r.rule,
        config: r.config,
        isActive: r.isActive,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  )
}
