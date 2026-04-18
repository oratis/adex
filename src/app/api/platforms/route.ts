import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

export async function GET() {
  try {
    const { org } = await requireAuthWithOrg()
    const auths = await prisma.platformAuth.findMany({
      where: { orgId: org.id },
    })

    const masked = auths.map(a => ({
      id: a.id,
      platform: a.platform,
      accountId: a.accountId,
      appId: a.appId,
      apiKey: a.apiKey,
      extra: a.extra,
      isActive: a.isActive,
      hasRefreshToken: !!a.refreshToken,
      hasAccessToken: !!a.accessToken,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }))

    return NextResponse.json(masked)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, org } = await requireAuthWithOrg()
    const data = await req.json()
    const platform = data.platform as string

    // Check if record exists (scoped to org)
    const existing = await prisma.platformAuth.findUnique({
      where: { orgId_platform: { orgId: org.id, platform } },
    })

    if (existing) {
      const updates: Record<string, string | boolean> = { isActive: true }
      if (data.accountId) updates.accountId = data.accountId
      if (data.appId) updates.appId = data.appId
      if (data.appSecret) updates.appSecret = data.appSecret
      if (data.apiKey) updates.apiKey = data.apiKey
      if (data.accessToken) updates.accessToken = data.accessToken
      if (data.refreshToken) updates.refreshToken = data.refreshToken

      const auth = await prisma.platformAuth.update({
        where: { id: existing.id },
        data: updates,
      })

      return NextResponse.json({
        id: auth.id, platform: auth.platform, isActive: auth.isActive,
        accountId: auth.accountId, apiKey: auth.apiKey, appId: auth.appId,
      })
    } else {
      const auth = await prisma.platformAuth.create({
        data: {
          orgId: org.id,
          userId: user.id,
          platform,
          accountId: data.accountId || null,
          appId: data.appId || null,
          appSecret: data.appSecret || null,
          apiKey: data.apiKey || null,
          accessToken: data.accessToken || null,
          refreshToken: data.refreshToken || null,
        },
      })

      return NextResponse.json({
        id: auth.id, platform: auth.platform, isActive: auth.isActive,
        accountId: auth.accountId, apiKey: auth.apiKey, appId: auth.appId,
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save authorization'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { org } = await requireAuthWithOrg()
    const { platform } = await req.json()
    await prisma.platformAuth.deleteMany({
      where: { orgId: org.id, platform },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
