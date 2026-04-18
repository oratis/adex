import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { cookies } from 'next/headers'
import { ACTIVE_ORG_COOKIE } from '@/lib/auth'

// GET /api/orgs — list orgs the current user is a member of
export async function GET() {
  try {
    const user = await requireAuth()
    const memberships = await prisma.orgMembership.findMany({
      where: { userId: user.id },
      include: { org: true },
      orderBy: { createdAt: 'asc' },
    })

    const cookieStore = await cookies()
    const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value

    return NextResponse.json(
      memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.role,
        createdAt: m.org.createdAt,
        isActive:
          (activeOrgId && m.orgId === activeOrgId) ||
          (!activeOrgId && m === memberships[0]),
      }))
    )
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

// POST /api/orgs — create a new org; creator becomes owner
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { name } = await req.json()
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const cleanName = name.trim().slice(0, 100)
    const baseSlug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'workspace'
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`

    const org = await prisma.organization.create({
      data: {
        name: cleanName,
        slug,
        createdBy: user.id,
        members: {
          create: { userId: user.id, role: 'owner' },
        },
      },
    })

    return NextResponse.json(org)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Create failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
