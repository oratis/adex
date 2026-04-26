import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { executeApprovedDecision } from '@/lib/agent/act'
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
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) return false
  const ts = req.headers.get('x-slack-request-timestamp')
  const sig = req.headers.get('x-slack-signature')
  if (!ts || !sig) return false
  // Reject older than 5 minutes
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts))
  if (!Number.isFinite(age) || age > 300) return false
  const base = `v0:${ts}:${raw}`
  const expected = `v0=${crypto.createHmac('sha256', secret).update(base).digest('hex')}`
  if (sig.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
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

  if (approveMatch) {
    const decisionId = approveMatch[1]
    const decision = await prisma.decision.findUnique({
      where: { id: decisionId },
      include: { approval: true },
    })
    if (!decision || decision.status !== 'pending') {
      return NextResponse.json({
        text: `Decision ${decisionId} is not pending; nothing to do.`,
      })
    }
    // We can't trust the Slack user as a real Adex user (no SSO yet) — but
    // we record the slack username for audit, and the approval gets attributed
    // to the system. Tighten by adding SLACK_USER_ID → adex User mapping later.
    await prisma.decision.update({
      where: { id: decisionId },
      data: {
        approvedBy: `slack:${payload.user?.id || 'unknown'}`,
        approvedAt: new Date(),
      },
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
      text: `✅ Decision approved by ${payload.user?.username || 'Slack user'} → ${result.status}`,
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
      return NextResponse.json({
        text: `Decision ${decisionId} is not pending; nothing to do.`,
      })
    }
    await prisma.decision.update({
      where: { id: decisionId },
      data: {
        status: 'rejected',
        rejectedReason: `via Slack by ${payload.user?.username || payload.user?.id || 'unknown'}`,
        approvedBy: `slack:${payload.user?.id || 'unknown'}`,
        approvedAt: new Date(),
      },
    })
    if (decision.approval) {
      await prisma.pendingApproval.delete({ where: { id: decision.approval.id } })
    }
    return NextResponse.json({
      text: `🛑 Decision rejected by ${payload.user?.username || 'Slack user'}`,
      replace_original: false,
      response_type: 'ephemeral',
    })
  }

  return NextResponse.json({
    text: `Unknown action: ${action.action_id}`,
    response_type: 'ephemeral',
  })
}
