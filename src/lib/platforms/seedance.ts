export interface SeedanceConfig {
  apiKey: string
  baseUrl?: string
}

export class SeedanceClient {
  private config: SeedanceConfig

  constructor(config: SeedanceConfig) {
    this.config = config
  }

  private get baseUrl() {
    return this.config.baseUrl || 'https://api.seedance.ai/v1'
  }

  async generateVideo(params: {
    prompt: string
    referenceImageUrl?: string
    duration?: number
    resolution?: string
    style?: string
  }) {
    const response = await fetch(`${this.baseUrl}/videos/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: params.prompt,
        reference_image_url: params.referenceImageUrl,
        duration: params.duration || 15,
        resolution: params.resolution || '1080p',
        style: params.style,
      }),
    })
    return response.json()
  }

  async getTaskStatus(taskId: string) {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
    })
    return response.json()
  }

  async downloadVideo(videoUrl: string): Promise<Buffer> {
    const response = await fetch(videoUrl)
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
}
