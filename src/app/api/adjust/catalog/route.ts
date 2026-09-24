import { NextRequest } from 'next/server'
import { adjustClient, AdjustSetupError } from '@/lib/reports/adjust-service'
import { withAdjustAuth } from '../_shared'

export async function GET(req: NextRequest) {
  return withAdjustAuth(true, async ({ org }) => {
    const appToken = req.nextUrl.searchParams.get('appToken') || ''
    const client = await adjustClient(org.id, appToken)
    const apps = await client.listApps()
    if (!appToken) return { apps }
    if (!apps.some((app) => app.id === appToken))
      throw new AdjustSetupError(404, 'App is not accessible')
    return { events: await client.listEvents() }
  })
}
