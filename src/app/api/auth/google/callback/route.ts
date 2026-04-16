import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.GOOGLE_ADS_REDIRECT_URI || ''
const PUBLIC_URL = process.env.PUBLIC_URL || ''
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '/adex'

function publicRedirect(path: string) {
  return NextResponse.redirect(`${PUBLIC_URL}${BASE_PATH}${path}`)
}

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code')
    const error = req.nextUrl.searchParams.get('error')

    if (error) {
      return publicRedirect(`/settings?error=google_auth_denied`)
    }

    if (!code) {
      return publicRedirect(`/settings?error=no_code`)
    }

    // Get current user - must be logged in
    const user = await getCurrentUser()
    if (!user) {
      // User not logged in — redirect to login with a message
      return publicRedirect(`/settings?error=not_logged_in&detail=${encodeURIComponent('Please log in first, then authorize Google again.')}`)
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    const tokens = await tokenRes.json()

    if (!tokenRes.ok) {
      console.error('Token exchange failed:', JSON.stringify(tokens))
      return publicRedirect(`/settings?error=token_exchange_failed&detail=${encodeURIComponent(tokens.error_description || tokens.error || 'unknown')}`)
    }

    if (!tokens.access_token) {
      console.error('No access_token in response:', JSON.stringify(tokens))
      return publicRedirect(`/settings?error=no_access_token`)
    }

    // Build token data
    const tokenData: Record<string, unknown> = {
      accessToken: tokens.access_token,
      extra: JSON.stringify({
        token_type: tokens.token_type,
        expires_in: tokens.expires_in,
        scope: tokens.scope,
        obtained_at: new Date().toISOString(),
      }),
      isActive: true,
    }
    if (tokens.refresh_token) {
      tokenData.refreshToken = tokens.refresh_token
    }

    // Save to PlatformAuth (find + update/create)
    const existing = await prisma.platformAuth.findUnique({
      where: { userId_platform: { userId: user.id, platform: 'google' } },
    })

    if (existing) {
      await prisma.platformAuth.update({
        where: { id: existing.id },
        data: tokenData,
      })
    } else {
      await prisma.platformAuth.create({
        data: {
          userId: user.id,
          platform: 'google',
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          extra: tokenData.extra as string,
          isActive: true,
        },
      })
    }

    return publicRedirect(`/settings?success=google_connected`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Google OAuth callback error:', message)
    return publicRedirect(`/settings?error=callback_failed&detail=${encodeURIComponent(message.substring(0, 200))}`)
  }
}
