import { NextRequest, NextResponse } from 'next/server'

// Google OAuth2 configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.GOOGLE_ADS_REDIRECT_URI || ''

// Initiate Google OAuth2 flow for Google Ads API access
export async function GET(req: NextRequest) {
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({
      error: 'GOOGLE_ADS_CLIENT_ID not configured',
      hint: 'Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in Cloud Run env vars'
    }, { status: 400 })
  }

  const scope = 'https://www.googleapis.com/auth/adwords'
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent', // Force consent to always get refresh_token
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`

  // Check if this is an API call or browser redirect
  const accept = req.headers.get('accept') || ''
  if (accept.includes('application/json')) {
    return NextResponse.json({ authUrl })
  }

  return NextResponse.redirect(authUrl)
}
