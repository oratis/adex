import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyBearer, readBearer } from '@/lib/growth/ingest-auth'
import { mapRevenueCatEvent } from '@/lib/growth/revenuecat'

/**
 * POST /api/ingest/revenuecat?org=<orgId>
 *
 * Receives a RevenueCat webhook (one event per call) and writes a normalized
 * ConversionEvent — the pilot's real-payment signal.
 *
 * Auth: RevenueCat sends a static `Authorization` header you configure in its
 * dashboard. We compare it (constant-time) to the org's stored secret in
 * PlatformAuth(platform='revenuecat').apiKey, with a REVENUECAT_WEBHOOK_SECRET
 * env fallback for single-tenant setups. This is the deliberate fix for the
 * HakkoAI "payment callback: no auth, no idempotency" P0 — auth here, and the
 * ConversionEvent unique key gives idempotency.
 */
export async function POST(req: NextRequest) {
  const orgId = new URL(req.url).searchParams.get('org')
  if (!orgId) {
    return NextResponse.json({ error: 'missing ?org' }, { status: 400 })
  }

  // Resolve the expected secret for this org (DB-backed, env fallback).
  let expected: string | undefined = process.env.REVENUECAT_WEBHOOK_SECRET
  try {
    const auth = await prisma.platformAuth.findUnique({
      where: { orgId_platform: { orgId, platform: 'revenuecat' } },
    })
    if (auth?.apiKey) expected = auth.apiKey
  } catch {
    // fall through to env fallback
  }

  const provided = readBearer(req.headers.get('authorization'))
  if (!verifyBearer(provided, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const mapped = mapRevenueCatEvent(payload)
  if (!mapped) {
    // Not funnel-relevant (TEST, BILLING_ISSUE, ...). Ack so RC stops retrying.
    return NextResponse.json({ ok: true, ignored: true })
  }

  // Idempotent write: the [orgId, source, eventName, userKey, occurredAt]
  // unique index de-dupes RC retries.
  const result = await prisma.conversionEvent.createMany({
    data: [
      {
        orgId,
        source: mapped.source,
        eventName: mapped.eventName,
        occurredAt: mapped.occurredAt,
        userKey: mapped.userKey ?? null,
        channel: mapped.channel ?? null,
        os: mapped.os ?? null,
        country: mapped.country ?? null,
        revenue: mapped.revenue ?? 0,
        raw: JSON.stringify(mapped.raw ?? payload),
      },
    ],
    skipDuplicates: true,
  })

  return NextResponse.json({ ok: true, written: result.count })
}
