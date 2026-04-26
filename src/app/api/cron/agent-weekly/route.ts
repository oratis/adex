import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mailer'

/**
 * POST /api/cron/agent-weekly
 *
 * Weekly digest of agent activity. Per docs/agent/09-roadmap.md §Phase 16
 * work item 5: outbound proof-of-life email so customers see what we did
 * (and what we didn't) without having to open the dashboard.
 *
 * Sends per-org to every owner/admin with a configured dailyReportEmail.
 */
function checkCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided =
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer /i, '')
  return provided === secret
}

export async function POST(req: NextRequest) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const enabled = await prisma.agentConfig.findMany({ where: { enabled: true } })
  const summary: Array<{ orgId: string; emailsSent: number; counts: Record<string, number> }> = []

  for (const cfg of enabled) {
    const decisions = await prisma.decision.findMany({
      where: { orgId: cfg.orgId, createdAt: { gte: since } },
      include: { outcome: true, steps: true },
    })
    const counts = {
      total: decisions.length,
      executed: decisions.filter((d) => d.status === 'executed').length,
      rejected: decisions.filter((d) => d.status === 'rejected').length,
      pending: decisions.filter((d) => d.status === 'pending').length,
      skipped: decisions.filter((d) => d.status === 'skipped').length,
      success: decisions.filter((d) => d.outcome?.classification === 'success').length,
      regression: decisions.filter((d) => d.outcome?.classification === 'regression').length,
      llmCostUsd: decisions.reduce((s, d) => s + (d.llmCostUsd || 0), 0),
    }
    const org = await prisma.organization.findUnique({
      where: { id: cfg.orgId },
      include: { members: { where: { role: { in: ['owner', 'admin'] } }, include: { user: true } } },
    })
    if (!org) continue

    const html = renderDigestHtml(org.name, cfg.mode, counts)
    let emailsSent = 0
    for (const m of org.members) {
      const to = m.user.dailyReportEmail || m.user.email
      if (!to) continue
      const r = await sendMail({
        to,
        subject: `[Adex] Agent weekly · ${org.name} · ${counts.executed} executed / ${counts.regression} regressions`,
        html,
      })
      if (r.ok) emailsSent++
    }
    summary.push({ orgId: cfg.orgId, emailsSent, counts })
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), summary })
}

function renderDigestHtml(
  orgName: string,
  mode: string,
  c: { total: number; executed: number; rejected: number; pending: number; skipped: number; success: number; regression: number; llmCostUsd: number }
): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 620px; color: #111;">
      <h2 style="color:#2563eb; margin-bottom:4px;">Adex Agent · weekly</h2>
      <p style="color:#6b7280; margin-top:0;">${orgName} · mode <strong>${mode}</strong></p>
      <table style="width:100%; border-collapse: collapse;">
        <tbody>
          <tr><td style="padding:6px 0;">Decisions created</td><td style="text-align:right;"><strong>${c.total}</strong></td></tr>
          <tr><td style="padding:6px 0;">Executed</td><td style="text-align:right;"><strong>${c.executed}</strong></td></tr>
          <tr><td style="padding:6px 0;">Rejected</td><td style="text-align:right;"><strong>${c.rejected}</strong></td></tr>
          <tr><td style="padding:6px 0;">Awaiting approval</td><td style="text-align:right;"><strong>${c.pending}</strong></td></tr>
          <tr><td style="padding:6px 0;">Shadow-only</td><td style="text-align:right;"><strong>${c.skipped}</strong></td></tr>
          <tr><td style="padding:6px 0;">✔ Verified successes</td><td style="text-align:right;"><strong>${c.success}</strong></td></tr>
          <tr><td style="padding:6px 0;">✘ Verified regressions</td><td style="text-align:right;"><strong>${c.regression}</strong></td></tr>
          <tr><td style="padding:6px 0;">LLM cost</td><td style="text-align:right;"><strong>$${c.llmCostUsd.toFixed(2)}</strong></td></tr>
        </tbody>
      </table>
      <p style="color:#9ca3af; font-size:12px; margin-top:24px;">
        Open <a href="/decisions" style="color:#2563eb;">decisions</a> · <a href="/approvals" style="color:#2563eb;">approvals</a>
      </p>
    </div>
  `
}
