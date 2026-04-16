import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { GoogleDriveClient, DriveFile } from '@/lib/platforms/gdrive'

// Google Drive folder ID and API key
const DRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '1FxJ5W6eCqVbw5VT_Jfu1VAZ4v_Jdvu9V'
const GDRIVE_API_KEY = process.env.GDRIVE_API_KEY || ''

export async function POST() {
  try {
    if (!GDRIVE_API_KEY) {
      return NextResponse.json({
        error: 'GDRIVE_API_KEY not configured',
        hint: 'Create a Google Cloud API key and set GDRIVE_API_KEY environment variable',
      }, { status: 400 })
    }

    const client = new GoogleDriveClient(GDRIVE_API_KEY)
    const stats = { synced: 0, skipped: 0, folders: 0, total: 0 }

    // Recursively sync the folder tree
    await syncFolder(client, DRIVE_FOLDER_ID, null, '', stats)

    return NextResponse.json({
      success: true,
      ...stats,
      folderId: DRIVE_FOLDER_ID,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function syncFolder(
  client: GoogleDriveClient,
  driveFolderId: string,
  parentAssetId: string | null,
  pathPrefix: string,
  stats: { synced: number; skipped: number; folders: number; total: number }
) {
  const items = await client.listAllFiles(driveFolderId)
  stats.total += items.length

  for (const item of items) {
    const isFolder = item.mimeType === 'application/vnd.google-apps.folder'
    const currentPath = pathPrefix ? `${pathPrefix}/${item.name}` : item.name

    if (isFolder) {
      // Create or find the folder asset
      const folderAsset = await upsertFolderAsset(item, parentAssetId, currentPath)
      stats.folders++
      // Recurse into subfolder
      await syncFolder(client, item.id, folderAsset.id, currentPath, stats)
      continue
    }

    // Skip non-asset files
    if (!GoogleDriveClient.isSupportedAsset(item.mimeType)) {
      stats.skipped++
      continue
    }

    // Sync file asset
    const wasCreated = await upsertFileAsset(client, item, parentAssetId, currentPath)
    if (wasCreated) {
      stats.synced++
    } else {
      stats.skipped++
    }
  }
}

async function upsertFolderAsset(
  file: DriveFile,
  parentId: string | null,
  folderPath: string
) {
  // Check if folder already exists by driveFileId
  const existing = await prisma.asset.findFirst({
    where: { driveFileId: file.id, source: 'gdrive' },
  })

  if (existing) {
    // Update name/path if changed
    await prisma.asset.update({
      where: { id: existing.id },
      data: { name: file.name, folderPath, parentId },
    })
    return existing
  }

  return prisma.asset.create({
    data: {
      uploadedBy: 'gdrive-sync',
      uploaderName: 'Google Drive',
      name: file.name,
      type: 'folder',
      source: 'gdrive',
      status: 'ready',
      isFolder: true,
      driveFileId: file.id,
      parentId,
      folderPath,
      tags: JSON.stringify(['gdrive', 'folder']),
    },
  })
}

async function upsertFileAsset(
  client: GoogleDriveClient,
  file: DriveFile,
  parentId: string | null,
  folderPath: string
): Promise<boolean> {
  // Check if already synced by driveFileId
  const existing = await prisma.asset.findFirst({
    where: { driveFileId: file.id, source: 'gdrive' },
  })

  if (existing) {
    // Update if modified
    if (new Date(file.modifiedTime) > new Date(existing.updatedAt)) {
      await prisma.asset.update({
        where: { id: existing.id },
        data: {
          name: file.name,
          fileUrl: client.getDownloadUrl(file.id),
          thumbnailUrl: file.thumbnailLink || client.getThumbnailUrl(file.id),
          fileSize: file.size ? parseInt(file.size) : null,
          parentId,
          folderPath,
        },
      })
      return true
    }
    return false
  }

  const isVideo = GoogleDriveClient.isVideo(file.mimeType)
  await prisma.asset.create({
    data: {
      uploadedBy: 'gdrive-sync',
      uploaderName: 'Google Drive',
      name: file.name,
      type: isVideo ? 'video' : 'image',
      source: 'gdrive',
      fileUrl: client.getDownloadUrl(file.id),
      thumbnailUrl: file.thumbnailLink || client.getThumbnailUrl(file.id),
      status: 'ready',
      fileSize: file.size ? parseInt(file.size) : null,
      duration: file.videoMediaMetadata?.durationMillis
        ? Math.round(parseInt(file.videoMediaMetadata.durationMillis) / 1000)
        : null,
      driveFileId: file.id,
      parentId,
      folderPath,
      tags: JSON.stringify(['gdrive', 'synced']),
    },
  })
  return true
}

// GET: Check sync status
export async function GET() {
  try {
    const driveAssets = await prisma.asset.count({ where: { source: 'gdrive', isFolder: false } })
    const driveFolders = await prisma.asset.count({ where: { source: 'gdrive', isFolder: true } })
    const latestSync = await prisma.asset.findFirst({
      where: { source: 'gdrive' },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    })

    return NextResponse.json({
      folderId: DRIVE_FOLDER_ID,
      assetsCount: driveAssets,
      foldersCount: driveFolders,
      lastSynced: latestSync?.updatedAt || null,
      apiKeyConfigured: !!GDRIVE_API_KEY,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 })
  }
}
