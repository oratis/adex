/**
 * Seedance2 (doubao-seedance-2-0) REST API Client
 * Endpoint: https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
 * Supports: text-to-video, image-to-video, video-to-video, with reference images/videos/audio
 */

export interface Seedance2Config {
  apiKey: string
  baseUrl?: string
  model?: string
}

export interface ContentItem {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url'
  text?: string
  image_url?: { url: string }
  video_url?: { url: string }
  audio_url?: { url: string }
  role?: 'reference_image' | 'reference_video' | 'reference_audio'
}

export interface Seedance2TaskRequest {
  model: string
  content: ContentItem[]
  generate_audio?: boolean
  ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
  duration?: number // seconds
  watermark?: boolean
}

export interface Seedance2TaskResponse {
  id: string
  model: string
  // ⚠️ Response `content` is NOT the request's ContentItem[]. The real
  // doubao-seedance-2-0-260128 success response (verified 2026-07-10 against
  // task cgt-20260710153030-s5t5x) returns:
  //   content:  { video_url: "https://..." }   ← an OBJECT, video_url is a STRING
  //   duration: 5                              ← TOP-LEVEL number
  //   output:   absent
  // Older/other models may instead use output.video_url / output.duration, or
  // an array-form content. We keep all shapes loosely typed and resolve
  // defensively — see resolveVideoUrl / resolveDuration. Do NOT assume an array.
  content?: unknown
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  error?: { code: string; message: string }
  duration?: number
  output?: {
    video_url?: string
    duration?: number
  }
  usage?: {
    duration?: number
  }
  created_at: number
  updated_at: number
}

/** Pull a string url out of a content-item value that may be a bare string or `{ url }`. */
function videoUrlFromItem(item: unknown): string | undefined {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    const v = (item as { video_url?: unknown }).video_url
    if (typeof v === 'string') return v
    if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') {
      return (v as { url: string }).url
    }
  }
  return undefined
}

/**
 * Resolve the generated video URL from a task response, defensive across shapes:
 *   1. content as object `{ video_url: "http..." }` (real doubao-seedance-2-0-260128)
 *   2. content as array of items (older/other models) — skips reference inputs (role set)
 *   3. output.video_url (legacy fallback)
 * Returns undefined rather than throwing on an unexpected shape.
 */
export function resolveVideoUrl(task: Seedance2TaskResponse): string | undefined {
  const content = task.content
  if (Array.isArray(content)) {
    for (const c of content) {
      // Skip echoed reference inputs — only the generated output has no role.
      if (c && typeof c === 'object' && (c as { role?: unknown }).role) continue
      const url = videoUrlFromItem(c)
      if (url) return url
    }
  } else {
    const url = videoUrlFromItem((content as { video_url?: unknown } | undefined))
    if (url) return url
  }
  return task.output?.video_url
}

/**
 * Resolve the rendered duration (seconds), defensive across shapes: real model
 * returns it top-level; others under output/usage. undefined if none present.
 */
export function resolveDuration(task: Seedance2TaskResponse): number | undefined {
  const d = task.duration ?? task.output?.duration ?? task.usage?.duration
  return typeof d === 'number' && Number.isFinite(d) ? Math.round(d) : undefined
}

export class Seedance2Client {
  private config: Seedance2Config

  constructor(config: Seedance2Config) {
    this.config = config
  }

  private get baseUrl() {
    return this.config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3'
  }

  private get model() {
    return this.config.model || 'doubao-seedance-2-0-260128'
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    }
  }

  /**
   * Create a video generation task
   */
  async createTask(params: {
    prompt: string
    referenceImages?: string[]
    referenceVideos?: string[]
    referenceAudios?: string[]
    generateAudio?: boolean
    ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
    duration?: number
    watermark?: boolean
  }): Promise<Seedance2TaskResponse> {
    const content: ContentItem[] = []

    // Add text prompt
    content.push({
      type: 'text',
      text: params.prompt,
    })

    // Add reference images
    if (params.referenceImages) {
      for (const url of params.referenceImages) {
        content.push({
          type: 'image_url',
          image_url: { url },
          role: 'reference_image',
        })
      }
    }

    // Add reference videos
    if (params.referenceVideos) {
      for (const url of params.referenceVideos) {
        content.push({
          type: 'video_url',
          video_url: { url },
          role: 'reference_video',
        })
      }
    }

    // Add reference audios
    if (params.referenceAudios) {
      for (const url of params.referenceAudios) {
        content.push({
          type: 'audio_url',
          audio_url: { url },
          role: 'reference_audio',
        })
      }
    }

    // Ark rejects a fractional `duration` with 400 InvalidParameter — the
    // API only accepts whole seconds (confirmed 2026-07 via creative-pipeline
    // commit e06e215/1224f1c). Round rather than truncate so e.g. 4.6s asks
    // for 5s, not 4s.
    const duration = Math.round(params.duration || 5)

    const body: Seedance2TaskRequest = {
      model: this.model,
      content,
      generate_audio: params.generateAudio ?? false,
      ratio: params.ratio || '16:9',
      duration,
      watermark: params.watermark ?? false,
    }

    const response = await fetch(`${this.baseUrl}/contents/generations/tasks`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Seedance2 API error ${response.status}: ${errText}`)
    }

    return response.json()
  }

  /**
   * Get task status
   */
  async getTask(taskId: string): Promise<Seedance2TaskResponse> {
    const response = await fetch(`${this.baseUrl}/contents/generations/tasks/${taskId}`, {
      headers: this.headers,
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Seedance2 API error ${response.status}: ${errText}`)
    }

    return response.json()
  }

  /**
   * Text-to-Video: Generate video from text prompt only
   */
  async textToVideo(params: {
    prompt: string
    ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
    duration?: number
    generateAudio?: boolean
  }) {
    return this.createTask({
      prompt: params.prompt,
      ratio: params.ratio,
      duration: params.duration,
      generateAudio: params.generateAudio,
    })
  }

  /**
   * Image-to-Video: Generate video using reference images
   */
  async imageToVideo(params: {
    prompt: string
    imageUrls: string[]
    ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
    duration?: number
    generateAudio?: boolean
  }) {
    return this.createTask({
      prompt: params.prompt,
      referenceImages: params.imageUrls,
      ratio: params.ratio,
      duration: params.duration,
      generateAudio: params.generateAudio,
    })
  }

  /**
   * Video-to-Video: Generate video using reference videos
   */
  async videoToVideo(params: {
    prompt: string
    videoUrls: string[]
    imageUrls?: string[]
    ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
    duration?: number
    generateAudio?: boolean
  }) {
    return this.createTask({
      prompt: params.prompt,
      referenceVideos: params.videoUrls,
      referenceImages: params.imageUrls,
      ratio: params.ratio,
      duration: params.duration,
      generateAudio: params.generateAudio,
    })
  }

  /**
   * Full creative: text + images + video + audio references
   */
  async createAdCreative(params: {
    prompt: string
    referenceImages?: string[]
    referenceVideos?: string[]
    referenceAudios?: string[]
    ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
    duration?: number
    generateAudio?: boolean
  }) {
    return this.createTask({
      ...params,
      generateAudio: params.generateAudio ?? true,
    })
  }
}
