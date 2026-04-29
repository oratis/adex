import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { drainPendingDeliveries } from '@/lib/webhooks'

export async function POST(req: NextRequest) {
  if (!(await verifyCronAuth(req, 'webhook-retry'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await drainPendingDeliveries(50)
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result })
}
