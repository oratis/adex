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
  content: ContentItem[]
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  error?: { code: string; message: string }
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

    const body: Seedance2TaskRequest = {
      model: this.model,
      content,
      generate_audio: params.generateAudio ?? false,
      ratio: params.ratio || '16:9',
      duration: params.duration || 5,
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
