import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg, assertRole, type OrgRole } from '@/lib/auth'

// PUT /api/orgs/members/[id] — change a member's role (admin/owner only).
// body: { role: 'owner' | 'admin' | 'member' }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { org, role } = await requireAuthWithOrg()
    assertRole(role, 'admin')

    const { id } = await params
    const { role: newRole } = (await req.json()) as { role: OrgRole }
    if (!['owner', 'admin', 'member'].includes(newRole)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const target = await prisma.orgMembership.findFirst({
      where: { id, orgId: org.id },
    })
    if (!target) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Non-owner admins cannot assign or remove owner role
    if (role !== 'owner' && (target.role === 'owner' || newRole === 'owner')) {
      return NextResponse.json(
        { error: 'Only an owner can modify owner-level roles' },
        { status: 403 }
      )
    }

    // If demoting an owner, ensure at least one owner remains
    if (target.role === 'owner' && newRole !== 'owner') {
      const ownerCount = await prisma.orgMembership.count({
        where: { orgId: org.id, role: 'owner' },
      })
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the sole owner of the organization' },
          { status: 400 }
        )
      }
    }

    const updated = await prisma.orgMembership.update({
      where: { id },
      data: { role: newRole },
    })
    return NextResponse.json(updated)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE /api/orgs/members/[id] — remove a member from the org
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, org, role } = await requireAuthWithOrg()
    const { id } = await params

    const target = await prisma.orgMembership.findFirst({
      where: { id, orgId: org.id },
    })
    if (!target) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Self-leave is always allowed (except for the last owner)
    // Kick: admin/owner only, and non-owner admin cannot kick owners
    const isSelf = target.userId === user.id
    if (!isSelf) {
      assertRole(role, 'admin')
      if (target.role === 'owner' && role !== 'owner') {
        return NextResponse.json(
          { error: 'Only an owner can remove another owner' },
          { status: 403 }
        )
      }
    }

    // Prevent removing the sole owner
    if (target.role === 'owner') {
      const ownerCount = await prisma.orgMembership.count({
        where: { orgId: org.id, role: 'owner' },
      })
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the sole owner of the organization' },
          { status: 400 }
        )
      }
    }

    await prisma.orgMembership.delete({ where: { id } })
    return NextResponse.json({ ok: true, self: isSelf })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Remove failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
