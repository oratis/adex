import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { GoogleAdsClient } from '@/lib/platforms/google'

/**
 * GET: List all accessible Google Ads accounts for the current org.
 */
export async function GET() {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const auth = await prisma.platformAuth.findFirst({
      where: { orgId: org.id, platform: 'google', isActive: true },
    })

    if (!auth) return NextResponse.json({ error: 'Google Ads not connected.' }, { status: 400 })
    if (!auth.refreshToken) return NextResponse.json({ error: 'No OAuth token. Click "Authorize with Google".' }, { status: 400 })
    if (!auth.apiKey) return NextResponse.json({ error: 'Developer Token not set.' }, { status: 400 })

    const client = new GoogleAdsClient({
      accessToken: auth.accessToken || '',
      refreshToken: auth.refreshToken,
      customerId: auth.accountId || '',
      developerToken: auth.apiKey,
    })

    const newToken = await client.refreshAccessToken()
    await prisma.platformAuth.update({
      where: { id: auth.id },
      data: { accessToken: newToken },
    })

    const accounts = await client.getClientAccounts()

    return NextResponse.json({
      accounts,
      mccId: auth.accountId || 'not set',
      totalAccounts: accounts.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch accounts'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
