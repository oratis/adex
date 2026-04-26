import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { fireWebhook } from '@/lib/webhooks'
import { applyCampaignStatusChange } from '@/lib/platforms/apply-status'
import { PlatformError, type DesiredStatus } from '@/lib/platforms/adapter'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { org } = await requireAuthWithOrg()
    const { id } = await params
    const campaign = await prisma.campaign.findFirst({
      where: { id, orgId: org.id },
      include: { budgets: true, adGroups: { include: { ads: { include: { creative: true } } } }, reports: true },
    })
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(campaign)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, org } = await requireAuthWithOrg()
    const { id } = await params
    const data = await req.json()

    // 1. Status changes (active/paused/archived) MUST go through the adapter
    //    so the platform side actually flips. Pull it out of the bulk update.
    const wantsStatusChange =
      typeof data.status === 'string' && ['active', 'paused', 'archived'].includes(data.status)
    if (wantsStatusChange) {
      try {
        await applyCampaignStatusChange({
          orgId: org.id,
          campaignId: id,
          status: data.status as DesiredStatus,
        })
      } catch (err) {
        const code = err instanceof PlatformError ? err.code : 'unknown'
        const msg = err instanceof Error ? err.message : 'Status change failed'
        return NextResponse.json({ error: msg, code }, { status: 502 })
      }
    }

    // 2. Apply non-status field changes
    const fieldUpdate: Record<string, unknown> = {}
    if (data.name !== undefined) fieldUpdate.name = data.name
    if (data.platform !== undefined) fieldUpdate.platform = data.platform
    if (data.objective !== undefined) fieldUpdate.objective = data.objective
    if (data.targetCountries !== undefined)
      fieldUpdate.targetCountries = JSON.stringify(data.targetCountries)
    if (data.targetAudience !== undefined)
      fieldUpdate.targetAudience = JSON.stringify(data.targetAudience)
    if (data.targetInterests !== undefined)
      fieldUpdate.targetInterests = JSON.stringify(data.targetInterests)
    if (data.ageMin !== undefined) fieldUpdate.ageMin = data.ageMin
    if (data.ageMax !== undefined) fieldUpdate.ageMax = data.ageMax
    if (data.gender !== undefined) fieldUpdate.gender = data.gender
    if (data.startDate !== undefined)
      fieldUpdate.startDate = data.startDate ? new Date(data.startDate) : null
    if (data.endDate !== undefined)
      fieldUpdate.endDate = data.endDate ? new Date(data.endDate) : null
    if (Object.keys(fieldUpdate).length > 0) {
      await prisma.campaign.updateMany({ where: { id, orgId: org.id }, data: fieldUpdate })
    }

    const action =
      data.status === 'paused' ? 'campaign.pause'
      : data.status === 'active' ? 'campaign.resume'
      : 'campaign.update'
    await logAudit({
      orgId: org.id,
      userId: user.id,
      action,
      targetType: 'campaign',
      targetId: id,
      metadata: data.status ? { status: data.status } : { updatedFields: Object.keys(data) },
      req,
    })
    if (data.status === 'paused' || data.status === 'active') {
      fireWebhook({
        orgId: org.id,
        event: data.status === 'paused' ? 'campaign.paused' : 'campaign.resumed',
        data: { campaignId: id, by: user.id },
      }).catch(() => {})
    }

    const updated = await prisma.campaign.findFirst({ where: { id, orgId: org.id } })
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, org } = await requireAuthWithOrg()
    const { id } = await params
    await prisma.campaign.deleteMany({ where: { id, orgId: org.id } })
    await logAudit({
      orgId: org.id,
      userId: user.id,
      action: 'campaign.delete',
      targetType: 'campaign',
      targetId: id,
      req,
    })
    fireWebhook({
      orgId: org.id,
      event: 'campaign.deleted',
      data: { campaignId: id, by: user.id },
    }).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
