import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, isPlatformAdmin } from '@/lib/auth'
import { UsersClient } from './client'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isPlatformAdmin(user)) notFound()

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      isPlatformAdmin: true,
      createdAt: true,
      memberships: { select: { orgId: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return (
    <UsersClient
      currentUserId={user.id}
      users={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        isPlatformAdmin: u.isPlatformAdmin,
        effectiveAdmin: isPlatformAdmin({ email: u.email, isPlatformAdmin: u.isPlatformAdmin }),
        createdAt: u.createdAt.toISOString(),
        orgs: u.memberships.length,
      }))}
    />
  )
}
