import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * POST /api/agent/prompts/{id}/promote
 *
 * Mark this PromptVersion as the default for its name (and demote any other
 * default for the same name). Used to roll forward a new prompt cleanly.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let role
  try {
    const ctx = await requireAuthWithOrg()
    role = ctx.role
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Owner/admin only' }, { status: 403 })
  }
  const { id } = await params
  const target = await prisma.promptVersion.findUnique({ where: { id } })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.$transaction([
    prisma.promptVersion.updateMany({
      where: { name: target.name, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.promptVersion.update({ where: { id: target.id }, data: { isDefault: true } }),
  ])
  return NextResponse.json({ ok: true, name: target.name, version: target.version })
}
