import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * GET /api/agent/orphans
 *
 * "Orphan" = a PlatformLink whose `localEntityId` equals `platformEntityId`,
 * meaning we discovered the campaign via snapshot but never bound it to a
 * local Campaign row. These need user attention — either bind to an existing
 * draft, import as a new local Campaign, or mark to ignore.
 *
 * POST body { platformLinkId, action }:
 *   - action='import'  → create a local Campaign + flip PlatformLink.localEntityId
 *   - action='ignore'  → set PlatformLink.status='orphan' (so future syncs skip it)
 */
export async function GET() {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const links = await prisma.platformLink.findMany({
    where: {
      orgId: org.id,
      entityType: 'campaign',
      status: 'active',
      // sentinel: localEntityId === platformEntityId == discovered, not yet bound
    },
    orderBy: { lastSyncedAt: 'desc' },
  })
  const orphans = links.filter((l) => l.localEntityId === l.platformEntityId)
  return NextResponse.json(orphans)
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
  const platformLinkId = body.platformLinkId
  const action = body.action
  if (typeof platformLinkId !== 'string') {
    return NextResponse.json({ error: 'platformLinkId required' }, { status: 400 })
  }
  if (action !== 'import' && action !== 'ignore') {
    return NextResponse.json({ error: 'action must be import|ignore' }, { status: 400 })
  }
  const link = await prisma.platformLink.findFirst({
    where: { id: platformLinkId, orgId: org.id, entityType: 'campaign' },
  })
  if (!link) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'ignore') {
    await prisma.platformLink.update({
      where: { id: link.id },
      data: { status: 'orphan' },
    })
    return NextResponse.json({ ok: true, status: 'orphan' })
  }

  // Import: parse name out of metadata.discoveredName if available
  let discoveredName: string | null = null
  if (link.metadata) {
    try {
      const m = JSON.parse(link.metadata) as { discoveredName?: string }
      discoveredName = typeof m.discoveredName === 'string' ? m.discoveredName : null
    } catch {
      /* ignore */
    }
  }
  const created = await prisma.campaign.create({
    data: {
      orgId: org.id,
      userId: user.id,
      name: discoveredName || `Imported ${link.platform} campaign ${link.platformEntityId}`,
      platform: link.platform,
      status: 'active',
      desiredStatus: 'active',
      platformCampaignId: link.platformEntityId,
    },
  })
  await prisma.platformLink.update({
    where: { id: link.id },
    data: { localEntityId: created.id },
  })
  return NextResponse.json({ ok: true, campaignId: created.id })
}
