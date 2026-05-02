import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth()
    const data = await req.json()

    const patch: Record<string, unknown> = {}
    if (typeof data.name === 'string') patch.name = data.name
    if (data.dailyReportEmail !== undefined) patch.dailyReportEmail = data.dailyReportEmail
    if (typeof data.timezone === 'string' && data.timezone.length > 0) patch.timezone = data.timezone
    if (data.slackUserId !== undefined) {
      // Empty string → null (unbind). Strip whitespace; basic format check.
      const v = typeof data.slackUserId === 'string' ? data.slackUserId.trim() : ''
      patch.slackUserId = v.length > 0 ? v : null
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: patch,
    })

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      dailyReportEmail: updated.dailyReportEmail,
      timezone: updated.timezone,
      slackUserId: updated.slackUserId,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
