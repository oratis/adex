import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { Seedance2Client } from '@/lib/platforms/seedance2'

const SEEDANCE2_API_KEY = process.env.SEEDANCE2_API_KEY || ''

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    const data = await req.json()

    const {
      name,
      prompt,
      mode, // text2video, image2video, video2video, full
      referenceImages,
      referenceVideos,
      referenceAudios,
      generateAudio,
      ratio,
      duration,
    } = data

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    const client = new Seedance2Client({ apiKey: SEEDANCE2_API_KEY })

    let result
    switch (mode) {
      case 'image2video':
        result = await client.imageToVideo({
          prompt,
          imageUrls: referenceImages || [],
          ratio,
          duration,
          generateAudio,
        })
        break
      case 'video2video':
        result = await client.videoToVideo({
          prompt,
          videoUrls: referenceVideos || [],
          imageUrls: referenceImages,
          ratio,
          duration,
          generateAudio,
        })
        break
      case 'full':
        result = await client.createAdCreative({
          prompt,
          referenceImages,
          referenceVideos,
          referenceAudios,
          ratio,
          duration,
          generateAudio,
        })
        break
      default: // text2video
        result = await client.textToVideo({
          prompt,
          ratio,
          duration,
          generateAudio,
        })
    }

    // Save to shared asset library
    const asset = await prisma.asset.create({
      data: {
        uploadedBy: user?.id || 'anonymous',
        uploaderName: user?.name || user?.email || 'Anonymous',
        name: name || `Seedance2 - ${new Date().toLocaleDateString()}`,
        type: 'video',
        source: 'seedance2',
        prompt,
        referenceData: JSON.stringify({
          referenceImages,
          referenceVideos,
          referenceAudios,
        }),
        taskId: result.id,
        status: 'generating',
        ratio: ratio || '16:9',
        duration: duration || 5,
        model: 'doubao-seedance-2-0-260128',
      },
    })

    return NextResponse.json({ asset, task: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
