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
  const prefix = gcsPublicPrefix()
  if (!publicUrl.startsWith(prefix)) return

  const objectPath = publicUrl.slice(prefix.length)
  const token = await getAccessToken()

  const deleteUrl = `https://storage.googleapis.com/storage/v1/b/${GCS_BUCKET}/o/${encodeURIComponent(objectPath)}`

  await fetch(deleteUrl, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  })
}

/** Public URL prefix for objects in our own bucket. Single source of truth. */
export function gcsPublicPrefix(): string {
  return `https://storage.googleapis.com/${GCS_BUCKET}/`
}

/** Is this URL an object already hosted in our own GCS bucket? */
export function isOwnGcsUrl(url: string): boolean {
  return url.startsWith(gcsPublicPrefix())
}

const PRIVATE_HOST_RE =
  /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|::1$|\[::1\]$|0\.0\.0\.0$|metadata\.google\.internal$)|^172\.(1[6-9]|2\d|3[01])\./i

/**
 * Fetch a remote media URL and upload it to GCS, returning the public URL.
 * Hardened for server-side fetch of caller-supplied URLs:
 *  - only http/https, and the host must not resolve to a private/link-local
 *    range (blocks SSRF to the metadata server / internal services)
 *  - rejects bodies over `maxBytes` (Content-Length pre-check + hard cap while
 *    reading) so one oversized file can't OOM the instance
 * Returns `{ fileUrl, contentType }`. Throws on validation/size/fetch failure.
 */
export async function uploadFromUrl(
  url: string,
  filename: string,
  opts: { maxBytes?: number } = {},
): Promise<{ fileUrl: string; contentType: string }> {
  const maxBytes = opts.maxBytes ?? 100 * 1024 * 1024 // 100MB default cap

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('invalid mediaUrl')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`mediaUrl scheme not allowed: ${parsed.protocol}`)
  }
  if (PRIVATE_HOST_RE.test(parsed.hostname)) {
    throw new Error(`mediaUrl host not allowed: ${parsed.hostname}`)
  }

  const res = await fetch(url, { redirect: 'error' })
  if (!res.ok) throw new Error(`fetch mediaUrl failed (${res.status})`)

  const declaredLen = Number(res.headers.get('content-length') || '0')
  if (declaredLen > maxBytes) {
    throw new Error(`mediaUrl too large (${declaredLen} > ${maxBytes})`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength > maxBytes) {
    throw new Error(`mediaUrl too large (${buffer.byteLength} > ${maxBytes})`)
  }

  const contentType = res.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream'
  const fileUrl = await uploadToGCS(buffer, filename, contentType)
  return { fileUrl, contentType }
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
