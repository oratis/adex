import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { GoogleAdsClient } from '@/lib/platforms/google'

/**
 * GET: List all accessible Google Ads accounts
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    const userId = user?.id || 'anonymous'

    // Try user-specific auth, fallback to anonymous
    let auth = await prisma.platformAuth.findFirst({
      where: { userId, platform: 'google', isActive: true },
    })
    if (!auth || !auth.refreshToken) {
      const anonAuth = await prisma.platformAuth.findFirst({
        where: { userId: 'anonymous', platform: 'google', isActive: true },
      })
      if (anonAuth?.refreshToken && auth) {
        await prisma.platformAuth.update({
          where: { id: auth.id },
          data: { refreshToken: anonAuth.refreshToken, accessToken: anonAuth.accessToken },
        })
        auth = await prisma.platformAuth.findFirst({ where: { id: auth.id } })
      } else if (anonAuth?.refreshToken) {
        auth = anonAuth
      }
    }

    if (!auth) return NextResponse.json({ error: 'Google Ads not connected.' }, { status: 400 })
    if (!auth.refreshToken) return NextResponse.json({ error: 'No OAuth token. Click "Authorize with Google".' }, { status: 400 })
    if (!auth.apiKey) return NextResponse.json({ error: 'Developer Token not set.' }, { status: 400 })

    const client = new GoogleAdsClient({
      accessToken: auth.accessToken || '',
      refreshToken: auth.refreshToken,
      customerId: auth.accountId || '',
      developerToken: auth.apiKey,
    })

    // Refresh token
    const newToken = await client.refreshAccessToken()
    await prisma.platformAuth.update({
      where: { id: auth.id },
      data: { accessToken: newToken },
    })

    // Get accounts
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
