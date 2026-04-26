import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * POST /api/agent/prompts/{id}/share
 *  body: { experimentalSharePct: number 0..100 }
 *
 * Ramp / dial down a PromptVersion's experimental traffic share. Same row
 * stays `isExperimental=true`; only the share pct changes. Setting to 0
 * effectively pauses the experiment without deleting the version.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const body = await req.json().catch(() => ({}))
  const pct = Number(body.experimentalSharePct)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return NextResponse.json(
      { error: 'experimentalSharePct must be 0..100' },
      { status: 400 }
    )
  }
  const target = await prisma.promptVersion.findUnique({ where: { id } })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!target.isExperimental) {
    return NextResponse.json(
      { error: 'PromptVersion is not isExperimental — cannot set share' },
      { status: 400 }
    )
  }
  const updated = await prisma.promptVersion.update({
    where: { id },
    data: { experimentalSharePct: Math.round(pct) },
  })
  return NextResponse.json(updated)
}
