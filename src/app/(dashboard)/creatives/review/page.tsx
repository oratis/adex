import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { ReviewClient } from './client'

export const dynamic = 'force-dynamic'

const VALID = new Set(['pending', 'approved', 'rejected'])

export default async function CreativeReviewPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')
  const sp = await props.searchParams
  const statusParam =
    typeof sp.status === 'string' && VALID.has(sp.status) ? sp.status : 'pending'

  const creatives = await prisma.creative.findMany({
    where: { orgId: ctx.org.id, reviewStatus: statusParam },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <ReviewClient
      role={ctx.role}
      filterStatus={statusParam}
      creatives={creatives.map((c) => {
        // tier/containsCompetitorFootage/competitorReferenced are stashed in
        // Creative.tags (JSON string) by /api/creatives/remix-jobs for t1/t2
        // remix jobs — hard IP-provenance markers a reviewer must see before
        // approving. tags is free-form for other sources, so parse defensively.
        let tier: string | null = null
        let containsCompetitorFootage = false
        let competitorReferenced = false
        if (c.tags) {
          try {
            const parsed = JSON.parse(c.tags)
            if (parsed && typeof parsed === 'object') {
              if (typeof parsed.tier === 'string') tier = parsed.tier
              containsCompetitorFootage = parsed.containsCompetitorFootage === true
              competitorReferenced = parsed.competitorReferenced === true
            }
          } catch {
            // non-JSON tags (other creative sources) — leave the markers false
          }
        }
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          source: c.source,
          prompt: c.prompt,
          fileUrl: c.fileUrl,
          reviewStatus: c.reviewStatus,
          reviewedBy: c.reviewedBy,
          reviewedAt: c.reviewedAt?.toISOString() ?? null,
          reviewNotes: c.reviewNotes,
          createdAt: c.createdAt.toISOString(),
          tier,
          containsCompetitorFootage,
          competitorReferenced,
        }
      })}
    />
  )
}
