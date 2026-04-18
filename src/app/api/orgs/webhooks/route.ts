import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg, assertRole } from '@/lib/auth'
import { generateWebhookSecret, WEBHOOK_EVENTS } from '@/lib/webhooks'

// GET /api/orgs/webhooks — list org webhooks (admin/owner)
export async function GET() {
  try {
    const { org, role } = await requireAuthWithOrg()
    assertRole(role, 'admin')

    const hooks = await prisma.webhook.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(
      hooks.map((h) => ({
        id: h.id,
        url: h.url,
        // Mask secret — only show prefix so you can identify which one it is
        secretPreview: h.secret.slice(0, 12) + '…',
        events: h.events.split(',').filter(Boolean),
        isActive: h.isActive,
        lastDeliveredAt: h.lastDeliveredAt,
        lastStatusCode: h.lastStatusCode,
        lastError: h.lastError,
        failureCount: h.failureCount,
        createdAt: h.createdAt,
      }))
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unauthorized'
    return NextResponse.json({ error: message }, { status: 403 })
  }
}

// POST /api/orgs/webhooks — create a webhook
// body: { url, events: string[] }
export async function POST(req: NextRequest) {
  try {
    const { user, org, role } = await requireAuthWithOrg()
    assertRole(role, 'admin')

    const { url, events } = (await req.json()) as { url: string; events: string[] }
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'Valid http(s) URL required' }, { status: 400 })
    }
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'events array required' }, { status: 400 })
    }
    const allValid = events.every(
      (e) => e === '*' || (WEBHOOK_EVENTS as readonly string[]).includes(e)
    )
    if (!allValid) {
      return NextResponse.json(
        { error: 'Unknown event name', valid: ['*', ...WEBHOOK_EVENTS] },
        { status: 400 }
      )
    }

    const secret = generateWebhookSecret()
    const webhook = await prisma.webhook.create({
      data: {
        orgId: org.id,
        url,
        secret,
        events: events.join(','),
        createdBy: user.id,
      },
    })

    // Return full secret ONCE on creation (never again)
    return NextResponse.json({
      id: webhook.id,
      url: webhook.url,
      events,
      secret, // show-once
      isActive: webhook.isActive,
      createdAt: webhook.createdAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Create failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
