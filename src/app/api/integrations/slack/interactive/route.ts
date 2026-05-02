import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { executeApprovedDecision } from '@/lib/agent/act'
import { verifySlackSignature as verifySig } from '@/lib/slack-signature'
import type { AgentMode } from '@/lib/agent/types'

/**
 * POST /api/integrations/slack/interactive
 *
 * Slack interactivity endpoint. Configure in your Slack app:
 *   Interactivity & Shortcuts → Request URL: https://adexads.com/api/integrations/slack/interactive
 *
 * Verifies the request via Slack's signing secret (env: SLACK_SIGNING_SECRET).
 * Today supports two action_ids:
 *   - `approve_decision_<decisionId>`
 *   - `reject_decision_<decisionId>`
 *
 * The block messages emitted by lib/slack-payload.ts include these buttons
 * when the event is `agent.approval.requested` (you can extend that builder
 * to add the actual buttons; this endpoint receives them).
 *
 * If SLACK_SIGNING_SECRET is unset, returns 500 — explicit, never silent
 * accepts unsigned bodies.
 */

function verifySlackSignature(req: NextRequest, raw: string): boolean {
  return verifySig({
    secret: process.env.SLACK_SIGNING_SECRET,
    timestamp: req.headers.get('x-slack-request-timestamp'),
    signature: req.headers.get('x-slack-signature'),
    rawBody: raw,
  })
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifySlackSignature(req, raw)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  // Slack posts application/x-www-form-urlencoded with field "payload"
  const params = new URLSearchParams(raw)
  const payloadStr = params.get('payload')
  if (!payloadStr) return NextResponse.json({ error: 'Missing payload' }, { status: 400 })
  let payload: { actions?: Array<{ action_id: string }>; user?: { id: string; username?: string } }
  try {
    payload = JSON.parse(payloadStr)
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }
  const action = payload.actions?.[0]
  if (!action?.action_id) return NextResponse.json({ error: 'No action' }, { status: 400 })

  const APPROVE_RE = /^approve_decision_(.+)$/
  const REJECT_RE = /^reject_decision_(.+)$/
  const approveMatch = action.action_id.match(APPROVE_RE)
  const rejectMatch = action.action_id.match(REJECT_RE)

  // Audit Critical #4: bind Slack user → Adex user. Without this, anyone
  // in the Slack workspace could approve/reject. Lookup is by
  // User.slackUserId (set via /settings → Profile) and confirms the user is
  // owner/admin in the decision's org.
  const slackUserId = payload.user?.id
  if (!slackUserId) {
    return NextResponse.json({ text: 'No Slack user id on action — refusing.' })
  }
  const adexUser = await prisma.user.findUnique({
    where: { slackUserId },
    include: { memberships: true },
  })
  if (!adexUser) {
    return NextResponse.json({
      text: `❌ Slack user @${payload.user?.username || slackUserId} is not linked to an Adex account. Bind it in Settings → Profile first.`,
      response_type: 'ephemeral',
    })
  }

  if (approveMatch) {
    const decisionId = approveMatch[1]
    const decision = await prisma.decision.findUnique({
      where: { id: decisionId },
      include: { approval: true },
    })
    if (!decision || decision.status !== 'pending') {
      return NextResponse.json({ text: `Decision ${decisionId} is not pending; nothing to do.` })
    }
    const membership = adexUser.memberships.find((m) => m.orgId === decision.orgId)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return NextResponse.json({
        text: `❌ ${adexUser.email} is not an owner/admin of the org that owns this decision.`,
        response_type: 'ephemeral',
      })
    }
    await prisma.decision.update({
      where: { id: decisionId },
      data: { approvedBy: adexUser.id, approvedAt: new Date() },
    })
    if (decision.approval) {
      await prisma.pendingApproval.delete({ where: { id: decision.approval.id } })
    }
    const result = await executeApprovedDecision(
      decision.orgId,
      decisionId,
      decision.mode as AgentMode
    )
    return NextResponse.json({
      text: `✅ Decision approved by ${adexUser.name || adexUser.email} → ${result.status}`,
      replace_original: false,
      response_type: 'ephemeral',
    })
  }

  if (rejectMatch) {
    const decisionId = rejectMatch[1]
    const decision = await prisma.decision.findUnique({
      where: { id: decisionId },
      include: { approval: true },
    })
    if (!decision || decision.status !== 'pending') {
      return NextResponse.json({ text: `Decision ${decisionId} is not pending; nothing to do.` })
    }
    const membership = adexUser.memberships.find((m) => m.orgId === decision.orgId)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return NextResponse.json({
        text: `❌ ${adexUser.email} is not an owner/admin of the org that owns this decision.`,
        response_type: 'ephemeral',
      })
    }
    await prisma.decision.update({
      where: { id: decisionId },
      data: {
        status: 'rejected',
        rejectedReason: `via Slack by ${adexUser.email}`,
        approvedBy: adexUser.id,
        approvedAt: new Date(),
      },
    })
    if (decision.approval) {
      await prisma.pendingApproval.delete({ where: { id: decision.approval.id } })
    }
    return NextResponse.json({
      text: `🛑 Decision rejected by ${adexUser.name || adexUser.email}`,
      replace_original: false,
      response_type: 'ephemeral',
    })
  }

  return NextResponse.json({
    text: `Unknown action: ${action.action_id}`,
    response_type: 'ephemeral',
  })
}
