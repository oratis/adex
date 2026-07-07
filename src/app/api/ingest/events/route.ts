import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyHmac } from '@/lib/growth/ingest-auth'
import { parseIncomingEvents } from '@/lib/growth/ingest-parse'

/**
 * POST /api/ingest/events?org=<orgId>
 *
 * Batch push of canonical conversion events (GA4 Measurement-Protocol style) —
 * the real-time backup channel when we're not pulling GA4 directly.
 *
 * Auth: HMAC-SHA256 over the raw body, keyed on the org's ingest secret
 * (PlatformAuth platform='ingest', env INGEST_WEBHOOK_SECRET fallback), with a
 * timestamp replay window. Headers: X-Adex-Timestamp, X-Adex-Signature.
 * Idempotent via the ConversionEvent unique key.
 */
export async function POST(req: NextRequest) {
  const orgId = new URL(req.url).searchParams.get('org')
  if (!orgId) return NextResponse.json({ error: 'missing ?org' }, { status: 400 })

  const rawBody = await req.text()

  let secret: string | undefined = process.env.INGEST_WEBHOOK_SECRET
  try {
    const auth = await prisma.platformAuth.findUnique({
      where: { orgId_platform: { orgId, platform: 'ingest' } },
    })
    if (auth?.apiKey) secret = auth.apiKey
  } catch {
    // fall through to env fallback
  }

  const ok = verifyHmac({
    secret,
    timestamp: req.headers.get('x-adex-timestamp'),
    signature: req.headers.get('x-adex-signature'),
    rawBody,
  })
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const events = parseIncomingEvents(payload)
  if (events.length === 0) return NextResponse.json({ ok: true, written: 0 })

  const result = await prisma.conversionEvent.createMany({
    data: events.map((e) => ({
      orgId,
      source: e.source,
      eventName: e.eventName,
      occurredAt: e.occurredAt,
      userKey: e.userKey ?? null,
      utmSource: e.utmSource ?? null,
      utmCampaign: e.utmCampaign ?? null,
      channel: e.channel ?? null,
      os: e.os ?? null,
      country: e.country ?? null,
      revenue: e.revenue ?? 0,
      agency: e.agency ?? null,
      raw: JSON.stringify(e.raw ?? e),
    })),
    skipDuplicates: true,
  })

  return NextResponse.json({ ok: true, received: events.length, written: result.count })
}
