import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { uploadToGCS } from '@/lib/storage'

export async function GET() {
  try {
    const { org } = await requireAuthWithOrg()
    const creatives = await prisma.creative.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(creatives)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, org } = await requireAuthWithOrg()
    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File
      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const filename = `${Date.now()}-${file.name}`

      const fileUrl = await uploadToGCS(buffer, filename, file.type || 'application/octet-stream')

      const isVideo = file.type.startsWith('video/')
      const creative = await prisma.creative.create({
        data: {
          orgId: org.id,
          userId: user.id,
          name: formData.get('name') as string || file.name,
          type: isVideo ? 'video' : 'image',
          source: 'upload',
          filePath: fileUrl,
          fileUrl,
        },
      })
      return NextResponse.json(creative)
    }

    // JSON body for AI generation
    const data = await req.json()
    const creative = await prisma.creative.create({
      data: {
        orgId: org.id,
        userId: user.id,
        name: data.name,
        type: data.type || 'image',
        source: data.source || 'seedream',
        prompt: data.prompt,
        status: 'generating',
        width: data.width,
        height: data.height,
      },
    })
    return NextResponse.json(creative)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create creative'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
