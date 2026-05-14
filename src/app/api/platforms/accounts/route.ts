import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

// List PlatformAccount rows for the current workspace. Filterable by platform.
export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuthWithOrg()
    const platform = req.nextUrl.searchParams.get('platform') || undefined
    const accounts = await prisma.platformAccount.findMany({
      where: { orgId: org.id, ...(platform ? { platform } : {}) },
      orderBy: [{ platform: 'asc' }, { isPrimary: 'desc' }, { createdAt: 'asc' }],
    })
    const masked = accounts.map(a => ({
      id: a.id,
      platform: a.platform,
      accountId: a.accountId,
      displayName: a.displayName,
      isPrimary: a.isPrimary,
      isActive: a.isActive,
      hasAccessToken: !!a.accessToken,
      hasRefreshToken: !!a.refreshToken,
      extra: a.extra,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }))
    return NextResponse.json(masked)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

// Upsert an account. If isPrimary=true, demote other primaries on same
// (org, platform) and mirror the accountId into PlatformAuth so the
// existing single-account adapters continue to read the right value.
export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuthWithOrg()
    const data = await req.json()
    const platform = String(data.platform || '').trim()
    const accountId = String(data.accountId || '').trim()
    if (!platform || !accountId) {
      return NextResponse.json({ error: 'platform and accountId are required' }, { status: 400 })
    }

    const isPrimary = data.isPrimary === true
    const payload = {
      displayName: data.displayName ?? null,
      isPrimary,
      isActive: data.isActive ?? true,
      accessToken: data.accessToken ?? undefined,
      refreshToken: data.refreshToken ?? undefined,
      extra: data.extra ?? undefined,
    }

    const account = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.platformAccount.updateMany({
          where: { orgId: org.id, platform, isPrimary: true, NOT: { accountId } },
          data: { isPrimary: false },
        })
      }
      const upserted = await tx.platformAccount.upsert({
        where: { orgId_platform_accountId: { orgId: org.id, platform, accountId } },
        update: payload,
        create: {
          orgId: org.id,
          platform,
          accountId,
          ...payload,
        },
      })
      if (isPrimary) {
        await tx.platformAuth.update({
          where: { orgId_platform: { orgId: org.id, platform } },
          data: { accountId },
        }).catch(() => {
          // PlatformAuth may not exist yet; the /api/platforms POST handler
          // is responsible for creating the connection. Silently ignore.
        })
      }
      return upserted
    })

    return NextResponse.json({
      id: account.id,
      platform: account.platform,
      accountId: account.accountId,
      displayName: account.displayName,
      isPrimary: account.isPrimary,
      isActive: account.isActive,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save account'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Remove an account. If it was the primary, the caller is expected to pick
// a new primary via a subsequent POST; we don't auto-promote.
export async function DELETE(req: NextRequest) {
  try {
    const { org } = await requireAuthWithOrg()
    const { platform, accountId } = await req.json()
    if (!platform || !accountId) {
      return NextResponse.json({ error: 'platform and accountId are required' }, { status: 400 })
    }
    await prisma.platformAccount.deleteMany({
      where: { orgId: org.id, platform, accountId },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
