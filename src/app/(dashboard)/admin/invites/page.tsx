import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, isPlatformAdmin } from '@/lib/auth'
import { InvitesClient } from './client'

export const dynamic = 'force-dynamic'

const VALID = new Set(['all', 'unused', 'used', 'expired', 'revoked'])

export default async function InvitesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isPlatformAdmin(user)) notFound()
  const sp = await props.searchParams
  const statusParam =
    typeof sp.status === 'string' && VALID.has(sp.status) ? sp.status : 'all'

  const where: Record<string, unknown> = {}
  if (statusParam === 'unused') {
    where.usedAt = null
    where.revokedAt = null
  } else if (statusParam === 'used') {
    where.usedAt = { not: null }
  } else if (statusParam === 'revoked') {
    where.revokedAt = { not: null }
  } else if (statusParam === 'expired') {
    where.usedAt = null
    where.expiresAt = { not: null, lt: new Date() }
  }
  const codes = await prisma.inviteCode.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      creator: { select: { email: true, name: true } },
      usedBy: { select: { email: true, name: true } },
    },
  })
  return (
    <InvitesClient
      filterStatus={statusParam}
      codes={codes.map((c) => ({
        id: c.id,
        code: c.code,
        note: c.note,
        createdBy: c.creator?.email || c.createdBy,
        createdAt: c.createdAt.toISOString(),
        expiresAt: c.expiresAt?.toISOString() || null,
        usedAt: c.usedAt?.toISOString() || null,
        usedBy: c.usedBy?.email || null,
        revokedAt: c.revokedAt?.toISOString() || null,
      }))}
    />
  )
}
