import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/creatives/review — list creatives awaiting review (or filter by
 * reviewStatus). Org-scoped.
 *
 * POST { creativeId, action: 'approve'|'reject', notes? } — admins set the
 * review verdict. Approved creatives become eligible for
 * push_creative_to_platform.
 */
export async function GET(req: NextRequest) {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || 'pending'
  const creatives = await prisma.creative.findMany({
    where: { orgId: org.id, reviewStatus: status },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json(creatives)
}

export async function POST(req: NextRequest) {
  let user, org, role
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
    role = ctx.role
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Owner/admin only' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const { creativeId, action } = body
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null
  if (typeof creativeId !== 'string') {
    return NextResponse.json({ error: 'creativeId required' }, { status: 400 })
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve|reject' }, { status: 400 })
  }
  const creative = await prisma.creative.findFirst({
    where: { id: creativeId, orgId: org.id },
  })
  if (!creative) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.creative.update({
    where: { id: creative.id },
    data: {
      reviewStatus: action === 'approve' ? 'approved' : 'rejected',
      reviewedBy: user.id,
      reviewedAt: new Date(),
      reviewNotes: notes,
    },
  })
  await logAudit({
    orgId: org.id,
    userId: user.id,
    action: 'creative.create',
    targetType: 'creative',
    targetId: creative.id,
    metadata: { reviewAction: action, name: creative.name },
    req,
  })
  return NextResponse.json(updated)
}
