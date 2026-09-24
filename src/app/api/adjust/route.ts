import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import {
  connectAdjust,
  parsePlan,
  saveAdjustPlan,
} from '@/lib/reports/adjust-service'
import { withAdjustAuth, readBody } from './_shared'

export async function GET() {
  return withAdjustAuth(false, async ({ org, role }) => {
    const connection = await prisma.platformAuth.findUnique({
      where: { orgId_platform: { orgId: org.id, platform: 'adjust' } },
      select: { isActive: true, apiKey: true },
    })
    const accounts = await prisma.platformAccount.findMany({
      where: { orgId: org.id, platform: 'adjust', isActive: true },
      select: { extra: true },
    })
    const plans = accounts.flatMap((account) => {
      try {
        return [parsePlan(JSON.parse(account.extra || '{}'))]
      } catch {
        return []
      }
    })
    const products = await prisma.promotedApp.findMany({
      where: { orgId: org.id },
      select: { id: true, name: true, platform: true },
      orderBy: { name: 'asc' },
    })
    return {
      connected: !!connection?.isActive && !!connection.apiKey,
      canManage: role !== 'member',
      plans,
      products,
    }
  })
}

export async function POST(req: NextRequest) {
  return withAdjustAuth(true, async ({ org, user }) => {
    const { token } = await readBody(req)
    const result = await connectAdjust(org.id, user.id, token)
    await logAudit({
      orgId: org.id,
      userId: user.id,
      action: 'platform.connect',
      targetType: 'platform',
      targetId: 'adjust',
      req,
    })
    return result
  })
}

export async function PUT(req: NextRequest) {
  return withAdjustAuth(true, async ({ org, user }) => {
    const { plan } = await readBody(req)
    const result = await saveAdjustPlan(org.id, parsePlan(plan))
    await logAudit({
      orgId: org.id,
      userId: user.id,
      action: 'platform.connect',
      targetType: 'adjust_app',
      targetId: result.id,
      req,
    })
    return result
  })
}
