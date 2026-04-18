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
        const signature = signWebhookBody(w.secret, body)
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
            body,
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
        }
      })
    )
  } catch (err) {
    console.error('[webhooks] fireWebhook failed:', err)
  }
}
