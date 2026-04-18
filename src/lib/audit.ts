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
