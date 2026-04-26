import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { PromptsClient } from './client'

export const dynamic = 'force-dynamic'

export default async function PromptsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')

  // PromptVersion is global (not org-scoped); only owners/admins should see this.
  const versions = await prisma.promptVersion.findMany({
    orderBy: [{ name: 'asc' }, { version: 'desc' }],
  })

  return (
    <PromptsClient
      role={ctx.role}
      versions={versions.map((v) => ({
        id: v.id,
        name: v.name,
        version: v.version,
        model: v.model,
        isDefault: v.isDefault,
        template: v.template,
        createdAt: v.createdAt.toISOString(),
      }))}
    />
  )
}
