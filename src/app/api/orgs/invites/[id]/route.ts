import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg, assertRole } from '@/lib/auth'

// DELETE /api/orgs/invites/[id] — revoke a pending invite
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { org, role } = await requireAuthWithOrg()
    assertRole(role, 'admin')

    const { id } = await params
    const result = await prisma.orgInvite.deleteMany({
      where: { id, orgId: org.id },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Revoke failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
