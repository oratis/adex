/**
 * Google Cloud Storage utility for file uploads.
 * Uses GCS JSON API with Application Default Credentials (ADC).
 * On Cloud Run, ADC is automatically available via the service account.
 */

const GCS_BUCKET = process.env.GCS_BUCKET || 'adex-data-gameclaw'
const GCS_UPLOAD_PREFIX = process.env.GCS_UPLOAD_PREFIX || 'uploads'

/**
 * Get an access token using Application Default Credentials.
 * On Cloud Run this uses the metadata server; locally falls back to gcloud.
 */
async function getAccessToken(): Promise<string> {
  // Try metadata server first (Cloud Run / GCE)
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } }
    )
    if (res.ok) {
      const data = await res.json()
      return data.access_token
    }
  } catch {
    // Not on GCE/Cloud Run
  }

  // Fallback: use GOOGLE_ACCESS_TOKEN env var (for local dev)
  if (process.env.GOOGLE_ACCESS_TOKEN) {
    return process.env.GOOGLE_ACCESS_TOKEN
  }

  // Fallback: try gcloud auth print-access-token
  try {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)
    const { stdout } = await execAsync('gcloud auth print-access-token')
    return stdout.trim()
  } catch {
    throw new Error('No GCS credentials available. Set GOOGLE_ACCESS_TOKEN or run on Cloud Run.')
  }
}

/**
 * Upload a file buffer to GCS and return its public URL.
 */
export async function uploadToGCS(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const objectPath = `${GCS_UPLOAD_PREFIX}/${filename}`
  const token = await getAccessToken()

  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${GCS_BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: new Uint8Array(buffer),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GCS upload failed (${res.status}): ${text.substring(0, 200)}`)
  }

  // Return the public URL
  return `https://storage.googleapis.com/${GCS_BUCKET}/${objectPath}`
}

/**
 * Delete a file from GCS by its public URL.
 */
export async function deleteFromGCS(publicUrl: string): Promise<void> {
  const prefix = `https://storage.googleapis.com/${GCS_BUCKET}/`
  if (!publicUrl.startsWith(prefix)) return

  const objectPath = publicUrl.slice(prefix.length)
  const token = await getAccessToken()

  const deleteUrl = `https://storage.googleapis.com/storage/v1/b/${GCS_BUCKET}/o/${encodeURIComponent(objectPath)}`

  await fetch(deleteUrl, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  })
}

/**
 * Check if GCS is available (for graceful fallback in dev).
 */
export async function isGCSAvailable(): Promise<boolean> {
  try {
    await getAccessToken()
    return true
  } catch {
    return false
  }
}

export { GCS_BUCKET, GCS_UPLOAD_PREFIX }
