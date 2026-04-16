export interface SeedreamConfig {
  apiKey: string
  baseUrl?: string
}

export class SeedreamClient {
  private config: SeedreamConfig

  constructor(config: SeedreamConfig) {
    this.config = config
  }

  private get baseUrl() {
    return this.config.baseUrl || 'https://api.seedream.ai/v1'
  }

  async generateImage(params: {
    prompt: string
    negativePrompt?: string
    width?: number
    height?: number
    numImages?: number
    style?: string
  }) {
    const response = await fetch(`${this.baseUrl}/images/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: params.prompt,
        negative_prompt: params.negativePrompt,
        width: params.width || 1080,
        height: params.height || 1080,
        num_images: params.numImages || 1,
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

  async downloadImage(imageUrl: string): Promise<Buffer> {
    const response = await fetch(imageUrl)
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
}
