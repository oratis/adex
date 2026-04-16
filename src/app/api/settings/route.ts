import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth()
    const data = await req.json()

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: data.name,
        dailyReportEmail: data.dailyReportEmail,
      },
    })

    return NextResponse.json({ id: updated.id, name: updated.name, email: updated.email, dailyReportEmail: updated.dailyReportEmail })
  } catch {
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
