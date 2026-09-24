import { NextRequest } from 'next/server'
import {
  parsePlan,
  parseRange,
  previewAdjust,
  readAdjustSnapshot,
  syncAdjustApp,
} from '@/lib/reports/adjust-service'
import { withAdjustAuth, readBody } from '../_shared'

export async function GET(req: NextRequest) {
  return withAdjustAuth(false, ({ org }) =>
    readAdjustSnapshot(org.id, req.nextUrl.searchParams.get('appToken') || ''),
  )
}

export async function POST(req: NextRequest) {
  return withAdjustAuth(true, async ({ org }) => {
    const body = await readBody(req)
    const range = parseRange(body.startDate, body.endDate)
    return previewAdjust(
      org.id,
      parsePlan(body.plan),
      range.startDate,
      range.endDate,
    )
  })
}

export async function PUT(req: NextRequest) {
  return withAdjustAuth(true, async ({ org }) => {
    const body = await readBody(req)
    const range = parseRange(body.startDate, body.endDate)
    return syncAdjustApp(
      org.id,
      String(body.appToken || ''),
      range.startDate,
      range.endDate,
    )
  })
}
