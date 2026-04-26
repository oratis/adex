import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'
import { applyCampaignStatusChange } from '@/lib/platforms/apply-status'
import { PlatformError } from '@/lib/platforms/adapter'

/**
 * Apply a safe, reversible advisor action. We deliberately restrict to
 * campaign status changes (pause/resume) in v1 — changing budgets or
 * creating new ad units requires more safeguards.
 *
 * Body: { action: 'pause_campaign' | 'resume_campaign', campaignId }
 */
export async function POST(req: NextRequest) {
  let user, org
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 20 automated actions / hour / user — conservative
  const rl = checkRateLimit(req, {
    key: 'advisor-apply',
    limit: 20,
    windowMs: 60 * 60_000,
    identity: user.id,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  try {
    const body = await req.json()
    const { action, campaignId } = body

    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId required' }, { status: 400 })
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, orgId: org.id },
    })
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found in current org' }, { status: 404 })
    }

    if (action !== 'pause_campaign' && action !== 'resume_campaign') {
      return NextResponse.json(
        { error: 'Unsupported action', supported: ['pause_campaign', 'resume_campaign'] },
        { status: 400 }
      )
    }

    const targetStatus = action === 'pause_campaign' ? 'paused' : 'active'
    if (action === 'pause_campaign' && campaign.status !== 'active') {
      return NextResponse.json(
        { error: `Campaign is ${campaign.status}, cannot pause` },
        { status: 400 }
      )
    }
    if (action === 'resume_campaign' && campaign.status !== 'paused') {
      return NextResponse.json(
        { error: `Campaign is ${campaign.status}, cannot resume` },
        { status: 400 }
      )
    }

    try {
      await applyCampaignStatusChange({
        orgId: org.id,
        campaignId: campaign.id,
        status: targetStatus,
      })
    } catch (err) {
      const code = err instanceof PlatformError ? err.code : 'unknown'
      const msg = err instanceof Error ? err.message : 'Apply failed'
      return NextResponse.json({ error: msg, code }, { status: 502 })
    }

    await logAudit({
      orgId: org.id,
      userId: user.id,
      action: 'advisor.apply',
      targetType: 'campaign',
      targetId: campaign.id,
      metadata: { applied: action, name: campaign.name },
      req,
    })
    return NextResponse.json({
      ok: true,
      message: action === 'pause_campaign' ? `Paused "${campaign.name}"` : `Resumed "${campaign.name}"`,
      campaign: { id: campaign.id, status: targetStatus },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Apply failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
