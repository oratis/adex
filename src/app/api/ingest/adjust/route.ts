import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyBearer, readBearer } from '@/lib/growth/ingest-auth'
import { mapAdjustCallback, type AdjustCallbackParams } from '@/lib/growth/adjust-ingest'

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
 * Auth: PlatformAuth(orgId, platform='ingest').apiKey, falling back to the
 * INGEST_WEBHOOK_SECRET env var (mirrors /api/ingest/events).
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

  let expected: string | undefined = process.env.INGEST_WEBHOOK_SECRET
  try {
    const auth = await prisma.platformAuth.findUnique({
      where: { orgId_platform: { orgId, platform: 'ingest' } },
    })
    if (auth?.apiKey) expected = auth.apiKey
  } catch {
    // fall through to env fallback
  }

  const provided = readBearer(req.headers.get('authorization')) ?? url.searchParams.get('token')
  if (!verifyBearer(provided, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const params: AdjustCallbackParams = Object.fromEntries(url.searchParams.entries())
  // Never persist the auth secret into ConversionEvent.raw.
  delete params.token
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

  const mapped = mapAdjustCallback(params)
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
        raw: JSON.stringify(mapped.raw ?? params),
      },
    ],
    skipDuplicates: true,
  })

  return NextResponse.json({ ok: true, written: result.count })
}
