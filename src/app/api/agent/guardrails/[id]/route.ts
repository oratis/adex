import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let org, role
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
    role = ctx.role
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Owner/admin only' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (body.config !== undefined) data.config = JSON.stringify(body.config)
  const row = await prisma.guardrail.updateMany({
    where: { id, orgId: org.id },
    data,
  })
  return NextResponse.json({ updated: row.count })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let org, role
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
    role = ctx.role
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Owner/admin only' }, { status: 403 })
  }
  const { id } = await params
  const res = await prisma.guardrail.deleteMany({ where: { id, orgId: org.id } })
  return NextResponse.json({ deleted: res.count })
}
