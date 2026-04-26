import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mailer'
import type { ProposedDecision } from './types'

/**
 * Notify owners/admins of an org that a Decision needs approval.
 *
 * Sends to anyone in the org who has `dailyReportEmail` set — they already
 * opted in to email pings from Adex. Best-effort and silent on failure.
 *
 * Updates PendingApproval.notifiedAt / notifiedVia so we don't double-send.
 */
export async function notifyApprovers(opts: {
  orgId: string
  decisionId: string
  proposed: ProposedDecision
}) {
  const approval = await prisma.pendingApproval.findUnique({
    where: { decisionId: opts.decisionId },
    include: { org: true },
  })
  if (!approval || approval.notifiedAt) return

  const recipients = await prisma.orgMembership.findMany({
    where: { orgId: opts.orgId, role: { in: ['owner', 'admin'] } },
    include: { user: true },
  })
  const emails = recipients
    .map((m) => m.user.dailyReportEmail || m.user.email)
    .filter((v): v is string => !!v)

  if (emails.length === 0) return

  const orgName = approval.org.name
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const link = baseUrl ? `${baseUrl.replace(/\/$/, '')}/approvals` : '/approvals'
  const stepsHtml = opts.proposed.steps
    .map(
      (s) =>
        `<li><code>${s.tool}</code>${s.reason ? ` — ${escapeHtml(s.reason)}` : ''}</li>`
    )
    .join('')

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; color: #111;">
      <h2 style="color: #2563eb;">Adex Agent · approval requested</h2>
      <p style="color: #6b7280;">${escapeHtml(orgName)} · severity <strong>${opts.proposed.severity}</strong></p>
      <p>${escapeHtml(opts.proposed.rationale)}</p>
      <h3 style="margin-bottom:6px;">Proposed steps</h3>
      <ul>${stepsHtml}</ul>
      <p>
        <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;">
          Open approvals queue
        </a>
      </p>
      <p style="color:#9ca3af;font-size:12px;">Decision id: ${opts.decisionId} · expires in 72h.</p>
    </div>
  `

  let sent = 0
  for (const to of emails) {
    const r = await sendMail({
      to,
      subject: `[Adex] Approval requested · ${opts.proposed.severity}`,
      html,
    })
    if (r.ok) sent++
  }

  if (sent > 0) {
    await prisma.pendingApproval.update({
      where: { id: approval.id },
      data: { notifiedAt: new Date(), notifiedVia: 'email' },
    })
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
