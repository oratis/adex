import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg, assertRole } from '@/lib/auth'

// PUT /api/orgs/webhooks/[id] — toggle isActive or update events/url
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { org, role } = await requireAuthWithOrg()
    assertRole(role, 'admin')

    const { id } = await params
    const data = await req.json()
    const updates: Record<string, unknown> = {}
    if (typeof data.isActive === 'boolean') updates.isActive = data.isActive
    if (Array.isArray(data.events)) updates.events = data.events.join(',')
    if (typeof data.url === 'string' && /^https?:\/\//i.test(data.url)) updates.url = data.url

    const result = await prisma.webhook.updateMany({
      where: { id, orgId: org.id },
      data: updates,
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE /api/orgs/webhooks/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { org, role } = await requireAuthWithOrg()
    assertRole(role, 'admin')

    const { id } = await params
    const result = await prisma.webhook.deleteMany({
      where: { id, orgId: org.id },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
