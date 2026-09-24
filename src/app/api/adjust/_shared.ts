import { NextResponse } from 'next/server'
import { requireAuthWithOrg } from '@/lib/auth'
import { AdjustSetupError } from '@/lib/reports/adjust-service'
import { isRecord } from '@/lib/reports/adjust-data'

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text()
  if (raw.length > 64_000)
    throw new AdjustSetupError(413, 'Request is too large')
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data)) throw new Error('Invalid object')
    return data
  } catch {
    throw new AdjustSetupError(400, 'Expected a JSON object')
  }
}

export async function withAdjustAuth(
  write: boolean,
  work: (
    context: Awaited<ReturnType<typeof requireAuthWithOrg>>,
  ) => Promise<unknown>,
) {
  let context: Awaited<ReturnType<typeof requireAuthWithOrg>>
  try {
    context = await requireAuthWithOrg()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (write && !['owner', 'admin'].includes(context.role))
    return NextResponse.json(
      { error: 'Workspace admin access required' },
      { status: 403 },
    )
  try {
    return NextResponse.json(await work(context), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof AdjustSetupError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      )
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('Configure PLATFORM_CREDENTIAL_KEY'))
      return NextResponse.json(
        { error: 'Credential encryption is not configured on this server' },
        { status: 503 },
      )
    // Do not expose provider bodies, tokens, database errors or request URLs.
    return NextResponse.json(
      { error: 'Adjust request failed; no report was overwritten' },
      { status: 502 },
    )
  }
}
