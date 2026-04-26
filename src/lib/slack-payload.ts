/**
 * Format an internal Adex webhook event as a Slack incoming-webhook payload.
 *
 * Slack accepts either a plain `text` field or a Block Kit `blocks` array.
 * We always emit `text` (so notifications show in mobile previews) plus a
 * concise blocks layout. Webhook subscribers whose URL matches
 * `hooks.slack.com/services/…` should opt into this transform via the
 * `slack` event filter prefix or by URL detection in the consumer.
 */
import type { WebhookEvent } from './webhooks'

export type SlackPayload = {
  text: string
  blocks: Array<Record<string, unknown>>
}

const SEVERITY_COLOR: Record<string, string> = {
  info: '#9ca3af',
  opportunity: '#10b981',
  warning: '#f59e0b',
  alert: '#ef4444',
}

export function buildSlackPayload(opts: {
  event: WebhookEvent
  orgId: string
  data: Record<string, unknown>
  appBaseUrl?: string
}): SlackPayload {
  const { event, orgId, data, appBaseUrl } = opts
  const link = (path: string) =>
    appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}${path}` : path

  const fallback = headlineFor(event, data)
  const severity = String((data.severity as string) || 'info')
  const color = SEVERITY_COLOR[severity] || SEVERITY_COLOR.info

  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Adex · ${event}*\n${fallback}` },
    },
  ]
  const fields: Array<{ type: string; text: string }> = []
  const interesting = ['decisionId', 'campaignId', 'platformAdId', 'severity', 'mode', 'reason', 'platformCampaignId', 'rationale']
  for (const k of interesting) {
    if (data[k] !== undefined) {
      const value = String(data[k]).slice(0, 200)
      fields.push({ type: 'mrkdwn', text: `*${k}*\n\`${value}\`` })
    }
  }
  if (fields.length > 0) {
    blocks.push({ type: 'section', fields: fields.slice(0, 10) })
  }
  if (event.startsWith('agent.') || event === 'ad.policy_rejected') {
    const elements: Array<Record<string, unknown>> = [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Open Adex' },
        url: link(event.startsWith('agent.approval') ? '/approvals' : '/decisions'),
      },
    ]
    // For approval requests, expose interactive Approve / Reject buttons
    // bound to /api/integrations/slack/interactive (configure in Slack app
    // Interactivity & Shortcuts → Request URL).
    if (event === 'agent.approval.requested' && typeof data.decisionId === 'string') {
      elements.unshift(
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          action_id: `approve_decision_${data.decisionId}`,
          value: data.decisionId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Reject' },
          style: 'danger',
          action_id: `reject_decision_${data.decisionId}`,
          value: data.decisionId,
        }
      )
    }
    blocks.push({ type: 'actions', elements })
  }

  return {
    text: `[${severity}] ${fallback}  (org ${orgId})`,
    blocks: [
      ...blocks,
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*severity*: ${severity} · *org*: \`${orgId}\` · color: ${color}`,
          },
        ],
      },
    ],
  }
}

function headlineFor(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case 'agent.decision.created':
      return `New ${String(data.severity || 'info')} decision (mode=${data.mode || 'shadow'})`
    case 'agent.decision.executed':
      return `Decision executed (${data.mode})`
    case 'agent.decision.failed':
      return `Decision failed (${data.mode})`
    case 'agent.approval.requested':
      return `Approval needed: ${String(data.rationale || 'see /approvals').slice(0, 160)}`
    case 'agent.killswitch.activated':
      return `Kill switch active: ${String(data.reason || 'no reason')}`
    case 'ad.policy_rejected':
      return `Ad rejected by platform: ${String(data.reason || 'no reason')}`
    default:
      return event
  }
}
