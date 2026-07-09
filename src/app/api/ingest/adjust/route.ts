import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyBearer, readBearer } from '@/lib/growth/ingest-auth'
import { mapAdjustCallback, type AdjustCallbackParams, type AdjustEventTokenMap } from '@/lib/growth/adjust-ingest'
import { EVENTS, type EventName } from '@/lib/growth/events'

const EVENT_NAME_SET = new Set<string>(Object.values(EVENTS))

/**
 * GET|POST /api/ingest/adjust?org=<orgId>&token=<secret>
 *
 * Receives an Adjust real-time S2S callback (docs/growth/06-mmp-ingest.md §3)
 * and writes a normalized ConversionEvent. Adjust's callback is a URL template
 * it expands itself — it can't sign a per-request HMAC and typically fires as
 * a GET, so auth is a static secret compared constant-time, same as
 * /api/ingest/revenuecat, except the secret may arrive via `?token=` (Adjust
 * can't set custom headers) in addition to `Authorization: Bearer`.
 *
 * Auth: PlatformAuth(orgId, platform='ingest_adjust').apiKey, falling back to
 * the INGEST_ADJUST_SECRET env var — a slot distinct from the events-route
 * HMAC secret, because this key travels in cleartext query strings. The same
 * row's `extra` JSON supplies the event-token map (custom Adjust event tokens
 * → canonical event names).
 *
 * A single callback maps to at most one event; unmapped activity_kind /
 * event_token combinations are dropped (200 ok, not written) so Adjust never
 * sees a 4xx/5xx and retries. Idempotent via the ConversionEvent unique key.
 */
export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('org')
  if (!orgId) {
    return NextResponse.json({ error: 'missing ?org' }, { status: 400 })
  }

  // Distinct secret slot (platform='ingest_adjust', env INGEST_ADJUST_SECRET).
  // Deliberately NOT the '/api/ingest/events' HMAC secret: this route has to
  // transmit its key in cleartext via `?token=` (Adjust can't set headers),
  // which lands in LB/access logs — a leak here must not let anyone forge
  // HMAC signatures for the events route. The same row's `extra` JSON also
  // carries the org's Adjust event-token map: {"eventTokenMap":{"abc123":"trial_start"}}.
  let expected: string | undefined = process.env.INGEST_ADJUST_SECRET
  let eventTokenMap: AdjustEventTokenMap | undefined
  try {
    const auth = await prisma.platformAuth.findUnique({
      where: { orgId_platform: { orgId, platform: 'ingest_adjust' } },
    })
    if (auth?.apiKey) expected = auth.apiKey
    if (auth?.extra) {
      try {
        const extra = JSON.parse(auth.extra) as { eventTokenMap?: Record<string, unknown> }
        if (extra.eventTokenMap && typeof extra.eventTokenMap === 'object') {
          // Only keep entries whose value is a canonical EventName — a typo'd
          // config entry degrades to "token unmapped → dropped", never a bad row.
          const validated: AdjustEventTokenMap = {}
          for (const [token, name] of Object.entries(extra.eventTokenMap)) {
            if (typeof name === 'string' && EVENT_NAME_SET.has(name)) {
              validated[token] = name as EventName
            }
          }
          eventTokenMap = validated
        }
      } catch {
        // malformed extra JSON — proceed without a map (installs still ingest)
      }
    }
  } catch {
    // fall through to env fallback
  }

  const provided = readBearer(req.headers.get('authorization')) ?? url.searchParams.get('token')
  if (!verifyBearer(provided, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const params: AdjustCallbackParams = Object.fromEntries(url.searchParams.entries())
  if (req.method === 'POST') {
    try {
      const form = await req.formData()
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') params[k] = v
      }
    } catch {
      // no form body — GET-style query params only, that's fine
    }
  }
  // Never persist the auth secret into ConversionEvent.raw — strip AFTER the
  // form merge, or a form field named `token` would smuggle it back in.
  delete params.token

  const mapped = mapAdjustCallback(params, eventTokenMap)
  if (!mapped) {
    // Not funnel-relevant (reattribution/session, unmapped event token). Ack
    // so Adjust doesn't retry.
    return NextResponse.json({ ok: true, ignored: true })
  }

  const result = await prisma.conversionEvent.createMany({
    data: [
      {
        orgId,
        source: mapped.source,
        eventName: mapped.eventName,
        occurredAt: mapped.occurredAt,
        userKey: mapped.userKey ?? null,
        utmCampaign: mapped.utmCampaign ?? null,
        channel: mapped.channel ?? null,
        os: mapped.os ?? null,
        country: mapped.country ?? null,
        revenue: mapped.revenue ?? 0,
        agency: mapped.agency ?? null,
        bidStrategy: mapped.bidStrategy ?? null,
        conversionGoal: mapped.conversionGoal ?? null,
        raw: JSON.stringify(mapped.raw ?? params),
      },
    ],
    skipDuplicates: true,
  })

  return NextResponse.json({ ok: true, written: result.count })
}
