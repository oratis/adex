import { NextRequest, NextResponse } from 'next/server'
import { drainPendingDeliveries } from '@/lib/webhooks'

function checkCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided =
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer /i, '')
  return provided === secret
}

export async function POST(req: NextRequest) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await drainPendingDeliveries(50)
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result })
}
