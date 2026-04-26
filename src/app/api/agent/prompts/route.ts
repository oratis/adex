import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * GET /api/agent/prompts — list all PromptVersion rows.
 * POST — create a new version of an existing prompt name. Auto-increments
 *        version. If isDefault=true, demotes any existing default for that
 *        name first (single-default invariant).
 */
export async function GET() {
  try {
    await requireAuthWithOrg()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const rows = await prisma.promptVersion.findMany({ orderBy: [{ name: 'asc' }, { version: 'desc' }] })
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
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
  const body = await req.json()
  if (!body.name || !body.template || !body.model) {
    return NextResponse.json({ error: 'name, template, model required' }, { status: 400 })
  }
  const last = await prisma.promptVersion.findFirst({
    where: { name: body.name },
    orderBy: { version: 'desc' },
  })
  const version = (last?.version ?? 0) + 1

  const isExperimental = !!body.isExperimental
  const sharePct = Number(body.experimentalSharePct) || 0
  const clampedShare = Math.max(0, Math.min(100, sharePct))

  const created = await prisma.$transaction(async (tx) => {
    if (body.isDefault) {
      await tx.promptVersion.updateMany({
        where: { name: body.name, isDefault: true },
        data: { isDefault: false },
      })
    }
    if (isExperimental) {
      // Single experimental row per name — supersede prior experimentals.
      await tx.promptVersion.updateMany({
        where: { name: body.name, isExperimental: true },
        data: { isExperimental: false, experimentalSharePct: 0 },
      })
    }
    return tx.promptVersion.create({
      data: {
        name: body.name,
        version,
        template: body.template,
        model: body.model,
        isDefault: !!body.isDefault,
        isExperimental,
        experimentalSharePct: isExperimental ? clampedShare : 0,
      },
    })
  })
  return NextResponse.json(created)
}
