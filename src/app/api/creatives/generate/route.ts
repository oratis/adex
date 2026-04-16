import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { SeedreamClient } from '@/lib/platforms/seedream'
import { SeedanceClient } from '@/lib/platforms/seedance'

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const data = await req.json()
    const { creativeId, type, prompt, width, height, style } = data

    // Get platform auth
    const platform = type === 'video' ? 'seedance' : 'seedream'
    const auth = await prisma.platformAuth.findFirst({
      where: { userId: user.id, platform, isActive: true },
    })
    if (!auth) {
      return NextResponse.json({ error: `No ${platform} authorization found. Please configure in Settings.` }, { status: 400 })
    }

    let result: unknown

    if (type === 'video') {
      const client = new SeedanceClient({ apiKey: auth.apiKey! })
      result = await client.generateVideo({ prompt, style })
    } else {
      const client = new SeedreamClient({ apiKey: auth.apiKey! })
      result = await client.generateImage({ prompt, width, height, style })
    }

    if (creativeId) {
      await prisma.creative.update({
        where: { id: creativeId },
        data: { status: 'generating', prompt },
      })
    }

    return NextResponse.json({ success: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
