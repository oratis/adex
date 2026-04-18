import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { uploadToGCS } from '@/lib/storage'

// GET: List org-scoped assets.
export async function GET(req: NextRequest) {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = req.nextUrl.searchParams
    const type = searchParams.get('type')
    const source = searchParams.get('source')
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const parentId = searchParams.get('parentId')
    const folderId = searchParams.get('folderId')

    const where: Record<string, unknown> = { orgId: org.id }
    if (type) where.type = type
    if (source) where.source = source
    if (status) where.status = status

    const browseParentId = parentId || folderId
    if (browseParentId === 'root') where.parentId = null
    else if (browseParentId) where.parentId = browseParentId

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { prompt: { contains: search } },
        { tags: { contains: search } },
      ]
    }

    const assets = await prisma.asset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return NextResponse.json(assets)
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}

// POST: Upload a file to the org's asset library (stored on GCS)
export async function POST(req: NextRequest) {
  let user, org
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
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
      const tags = formData.get('tags') as string

      const asset = await prisma.asset.create({
        data: {
          orgId: org.id,
          uploadedBy: user.id,
          uploaderName: user.name || user.email,
          name: (formData.get('name') as string) || file.name,
          type: isVideo ? 'video' : 'image',
          source: 'upload',
          fileUrl,
          status: 'ready',
          tags: tags || null,
          fileSize: buffer.length,
        },
      })

      return NextResponse.json(asset)
    }

    return NextResponse.json({ error: 'Multipart form data required' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
