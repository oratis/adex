/**
 * Outgoing webhooks — fire a signed HTTP POST to every active webhook
 * subscribed to a given event.
 *
 * Request shape:
 *   POST <url>
 *   Content-Type: application/json
 *   X-Adex-Event: campaign.launched
 *   X-Adex-Signature: sha256=<hex>         — HMAC of the raw body using webhook.secret
 *   X-Adex-Delivery: <uuid>                — unique per delivery
 *   body: { event, orgId, data, timestamp }
 *
 * Caller is expected to `.catch()` or `void` the promise — webhook
 * failures should never abort the triggering request.
 */
import crypto from 'crypto'
import { prisma } from './prisma'
import { buildSlackPayload } from './slack-payload'

function isSlackUrl(url: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/services\//.test(url)
}

export type WebhookEvent =
  | 'campaign.launched'
  | 'campaign.paused'
  | 'campaign.resumed'
  | 'campaign.deleted'
  | 'budget.exceeded'
  | 'advisor.alert'
  | 'member.invited'
  | 'member.joined'
  | 'report.synced'
  | 'agent.decision.created'
  | 'agent.decision.executed'
  | 'agent.decision.failed'
  | 'agent.approval.requested'
  | 'agent.killswitch.activated'
  | 'ad.policy_rejected'
  | 'creative.review_requested'

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'campaign.launched',
  'campaign.paused',
  'campaign.resumed',
  'campaign.deleted',
  'budget.exceeded',
  'advisor.alert',
  'member.invited',
  'member.joined',
  'report.synced',
  'agent.decision.created',
  'agent.decision.executed',
  'agent.decision.failed',
  'agent.approval.requested',
  'agent.killswitch.activated',
  'ad.policy_rejected',
  'creative.review_requested',
]

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('base64url')}`
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
}

export async function fireWebhook(opts: {
  orgId: string
  event: WebhookEvent
  data: Record<string, unknown>
}): Promise<void> {
  try {
    const subscribers = await prisma.webhook.findMany({
      where: { orgId: opts.orgId, isActive: true },
    })

    const matching = subscribers.filter((w) => {
      const events = w.events.split(',').map((e) => e.trim()).filter(Boolean)
      return events.includes(opts.event) || events.includes('*')
    })
    if (matching.length === 0) return

    const body = JSON.stringify({
      event: opts.event,
      orgId: opts.orgId,
      data: opts.data,
      timestamp: new Date().toISOString(),
    })

    await Promise.all(
      matching.map(async (w) => {
        const deliveryId = crypto.randomUUID()
        // Slack webhooks expect their own JSON shape — transform if URL matches.
        const usingSlack = isSlackUrl(w.url)
        const wireBody = usingSlack
          ? JSON.stringify(
              buildSlackPayload({
                event: opts.event,
                orgId: opts.orgId,
                data: opts.data,
                appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
              })
            )
          : body
        const signature = signWebhookBody(w.secret, wireBody)
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 5000)
          const res = await fetch(w.url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Adex-Webhook/1.0',
              'X-Adex-Event': opts.event,
              'X-Adex-Signature': signature,
              'X-Adex-Delivery': deliveryId,
            },
            body: wireBody,
          })
          clearTimeout(timeout)

          await prisma.webhook.update({
            where: { id: w.id },
            data: {
              lastDeliveredAt: new Date(),
              lastStatusCode: res.status,
              lastError: res.ok ? null : `HTTP ${res.status}`,
              failureCount: res.ok ? 0 : w.failureCount + 1,
            },
          })
          if (!res.ok) {
            await scheduleRetry(w.id, opts.event, body, `HTTP ${res.status}`, res.status)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'delivery failed'
          await prisma.webhook.update({
            where: { id: w.id },
            data: {
              lastDeliveredAt: new Date(),
              lastStatusCode: null,
              lastError: message.slice(0, 500),
              failureCount: w.failureCount + 1,
            },
          })
          await scheduleRetry(w.id, opts.event, body, message, null)
        }
      })
    )
  } catch (err) {
    console.error('[webhooks] fireWebhook failed:', err)
  }
}

/**
 * Exponential back-off: 60s, 5m, 30m, 2h, 12h. After 5 attempts the row is
 * abandoned and surfaced via Webhook.failureCount.
 */
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200]

export function nextAttemptDelay(attemptIndex: number): number {
  return BACKOFF_SECONDS[Math.min(attemptIndex, BACKOFF_SECONDS.length - 1)]
}

async function scheduleRetry(
  webhookId: string,
  event: string,
  payload: string,
  reason: string,
  statusCode: number | null
): Promise<void> {
  try {
    await prisma.webhookDelivery.create({
      data: {
        webhookId,
        event,
        payload,
        attempts: 1, // we just made attempt #1
        nextAttemptAt: new Date(Date.now() + nextAttemptDelay(0) * 1000),
        lastStatusCode: statusCode,
        lastError: reason.slice(0, 500),
      },
    })
  } catch (err) {
    console.error('[webhooks] scheduleRetry failed:', err)
  }
}

/**
 * drainPendingDeliveries — called by /api/cron/webhook-retry. Picks up to
 * `max` due rows, re-POSTs each. Success → `succeededAt`. Failure with
 * remaining attempts → bumps attempts + schedules next. Out of attempts →
 * `abandonedAt` set.
 */
export async function drainPendingDeliveries(max = 50) {
  const due = await prisma.webhookDelivery.findMany({
    where: {
      succeededAt: null,
      abandonedAt: null,
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: max,
    include: { webhook: true },
  })
  let succeeded = 0
  let failed = 0
  let abandoned = 0
  for (const d of due) {
    if (!d.webhook.isActive) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { abandonedAt: new Date(), lastError: 'webhook deactivated' },
      })
      abandoned++
      continue
    }
    const deliveryId = crypto.randomUUID()
    const signature = signWebhookBody(d.webhook.secret, d.payload)
    let ok = false
    let status: number | null = null
    let err: string | null = null
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(d.webhook.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Adex-Webhook/1.0',
          'X-Adex-Event': d.event,
          'X-Adex-Signature': signature,
          'X-Adex-Delivery': deliveryId,
          'X-Adex-Retry-Attempt': String(d.attempts + 1),
        },
        body: d.payload,
      })
      clearTimeout(timeout)
      ok = res.ok
      status = res.status
      if (!ok) err = `HTTP ${res.status}`
    } catch (e) {
      err = e instanceof Error ? e.message : 'delivery failed'
    }

    if (ok) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { succeededAt: new Date(), lastStatusCode: status, lastError: null },
      })
      await prisma.webhook.update({
        where: { id: d.webhook.id },
        data: { lastStatusCode: status, lastDeliveredAt: new Date(), failureCount: 0, lastError: null },
      })
      succeeded++
      continue
    }
    const nextAttempts = d.attempts + 1
    if (nextAttempts >= d.maxAttempts) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts: nextAttempts,
          lastStatusCode: status,
          lastError: err?.slice(0, 500),
          abandonedAt: new Date(),
        },
      })
      abandoned++
    } else {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts: nextAttempts,
          lastStatusCode: status,
          lastError: err?.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + nextAttemptDelay(nextAttempts) * 1000),
        },
      })
      failed++
    }
  }
  return { processed: due.length, succeeded, failed, abandoned }
}
