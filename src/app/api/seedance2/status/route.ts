import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { Seedance2Client } from '@/lib/platforms/seedance2'

const SEEDANCE2_API_KEY = process.env.SEEDANCE2_API_KEY || ''

export async function GET(req: NextRequest) {
  try {
    await getCurrentUser() // optional auth
    const taskId = req.nextUrl.searchParams.get('taskId')
    const assetId = req.nextUrl.searchParams.get('assetId')

    if (!taskId) {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 })
    }

    const client = new Seedance2Client({ apiKey: SEEDANCE2_API_KEY })
    const task = await client.getTask(taskId)

    // Update asset in DB if status changed
    if (assetId) {
      const updateData: Record<string, unknown> = {}

      if (task.status === 'succeeded' && task.output?.video_url) {
        updateData.status = 'ready'
        updateData.fileUrl = task.output.video_url
        if (task.output.duration) updateData.duration = task.output.duration
      } else if (task.status === 'failed') {
        updateData.status = 'failed'
        updateData.errorMessage = task.error?.message || 'Generation failed'
      } else if (task.status === 'running' || task.status === 'queued') {
        updateData.status = 'generating'
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.asset.update({
          where: { id: assetId },
          data: updateData,
        })
      }
    }

    return NextResponse.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Status check failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
