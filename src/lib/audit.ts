/**
 * Audit-log helper — fire-and-forget.
 *
 * Call `logAudit()` after any consequential org-scoped action so a record
 * of who did what lands in the AuditEvent table. Failures are swallowed
 * to guarantee auditing never breaks the originating request.
 */
import { NextRequest } from 'next/server'
import { prisma } from './prisma'

export type AuditAction =
  // Campaigns
  | 'campaign.create'
  | 'campaign.update'
  | 'campaign.delete'
  | 'campaign.launch'
  | 'campaign.pause'
  | 'campaign.resume'
  // Creatives
  | 'creative.create'
  | 'creative.delete'
  | 'creative.attach'
  // Competitor intel (Tier-2 full-video storage — IP-sensitive, logged for provenance)
  | 'competitor.video_store'
  // t1/t2 remix claim hands the worker a competitor video reference — same IP
  // sensitivity as video_store, logged for provenance.
  | 'competitor.video_reference'
  // RemixJob (worker-engine competitor-remix path — src/app/api/worker/remix-jobs/**)
  | 'remix.job_create'
  | 'remix.job_claim'
  | 'remix.job_report'
  | 'remix.job_upload'
  // Budgets
  | 'budget.create'
  | 'budget.update'
  | 'budget.delete'
  // Platform auth
  | 'platform.connect'
  | 'platform.disconnect'
  // Members
  | 'member.invite'
  | 'member.invite_revoke'
  | 'member.invite_accept'
  | 'member.role_change'
  | 'member.remove'
  // Workspace
  | 'org.create'
  | 'org.switch'
  // AI
  | 'advisor.apply'
  // System
  | 'cron.daily'

export async function logAudit(opts: {
  orgId: string
  userId?: string | null
  action: AuditAction
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
  req?: NextRequest
}): Promise<void> {
  try {
    const ip =
      opts.req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      opts.req?.headers.get('x-real-ip') ||
      null

    await prisma.auditEvent.create({
      data: {
        orgId: opts.orgId,
        userId: opts.userId ?? null,
        action: opts.action,
        targetType: opts.targetType || null,
        targetId: opts.targetId || null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
        ipAddress: ip,
      },
    })
  } catch (err) {
    // Never let audit-logging break the actual action
    console.error('[audit] failed to log event:', err)
  }
}
