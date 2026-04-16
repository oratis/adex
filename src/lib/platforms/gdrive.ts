/**
 * Google Drive integration for syncing ad assets from shared folders.
 * Uses Google Drive API v3 with API key for public/shared folders.
 */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  createdTime: string
  modifiedTime: string
  thumbnailLink?: string
  webContentLink?: string
  webViewLink?: string
  imageMediaMetadata?: {
    width: number
    height: number
  }
  videoMediaMetadata?: {
    width: number
    height: number
    durationMillis: string
  }
}

export class GoogleDriveClient {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /**
   * List files in a shared folder
   */
  async listFiles(folderId: string, pageToken?: string): Promise<{
    files: DriveFile[]
    nextPageToken?: string
  }> {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,thumbnailLink,webContentLink,webViewLink,imageMediaMetadata,videoMediaMetadata)',
      pageSize: '100',
      key: this.apiKey,
    })
    if (pageToken) params.set('pageToken', pageToken)

    const response = await fetch(`${DRIVE_API_BASE}/files?${params}`)
    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Drive API error ${response.status}: ${err}`)
    }
    return response.json()
  }

  /**
   * List ALL files in a folder (handles pagination)
   */
  async listAllFiles(folderId: string): Promise<DriveFile[]> {
    const allFiles: DriveFile[] = []
    let pageToken: string | undefined

    do {
      const result = await this.listFiles(folderId, pageToken)
      allFiles.push(...result.files)
      pageToken = result.nextPageToken
    } while (pageToken)

    return allFiles
  }

  /**
   * Recursively list ALL files in a folder and all subfolders
   */
  async listAllFilesRecursive(folderId: string, maxDepth = 5): Promise<DriveFile[]> {
    if (maxDepth <= 0) return []

    const allFiles: DriveFile[] = []
    const items = await this.listAllFiles(folderId)

    for (const item of items) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        // Recurse into subfolder
        const subFiles = await this.listAllFilesRecursive(item.id, maxDepth - 1)
        allFiles.push(...subFiles)
      } else {
        allFiles.push(item)
      }
    }

    return allFiles
  }

  /**
   * Get direct download URL for a file
   */
  getDownloadUrl(fileId: string): string {
    return `https://drive.google.com/uc?export=download&id=${fileId}`
  }

  /**
   * Get embeddable/preview URL for a file
   */
  getPreviewUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/preview`
  }

  /**
   * Get thumbnail URL
   */
  getThumbnailUrl(fileId: string): string {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`
  }

  /**
   * Check if a mime type is an image
   */
  static isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/')
  }

  /**
   * Check if a mime type is a video
   */
  static isVideo(mimeType: string): boolean {
    return mimeType.startsWith('video/')
  }

  /**
   * Check if file is a supported asset type
   */
  static isSupportedAsset(mimeType: string): boolean {
    return GoogleDriveClient.isImage(mimeType) || GoogleDriveClient.isVideo(mimeType)
  }
}
