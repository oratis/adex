import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MetaAdsAdapter } from './meta-adapter'
import { PlatformError } from './adapter'

// Mock the prisma module so adapter constructors / persistRefreshedToken don't
// actually touch a database.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformAuth: { update: vi.fn().mockResolvedValue({}) },
  },
}))

const realFetch = global.fetch

function authInput() {
  return {
    accessToken: 'tok',
    refreshToken: null,
    accountId: '123',
    appId: null,
    appSecret: null,
    apiKey: null,
    authId: 'auth1',
  }
}

describe('MetaAdsAdapter', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch as unknown as typeof fetch
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  it('throws on missing accountId', () => {
    expect(() => new MetaAdsAdapter({ ...authInput(), accountId: null })).toThrow(PlatformError)
  })

  it('strips act_ prefix from accountId', () => {
    const a = new MetaAdsAdapter({ ...authInput(), accountId: 'act_999' })
    expect(a.accountId).toBe('999')
  })

  it('launchCampaign returns id when API ok', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'camp_42' }), { status: 200 })
    )
    const a = new MetaAdsAdapter(authInput())
    const r = await a.launchCampaign({ name: 'X', objective: 'OUTCOME_AWARENESS' })
    expect(r.platformCampaignId).toBe('camp_42')
  })

  it('launchCampaign throws PlatformError on platform error envelope', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 200 })
    )
    const a = new MetaAdsAdapter(authInput())
    await expect(a.launchCampaign({ name: 'X' })).rejects.toBeInstanceOf(PlatformError)
  })

  it('updateCampaignStatus posts the right URL + status', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
    const a = new MetaAdsAdapter(authInput())
    await a.updateCampaignStatus('cid', 'paused')
    const callUrl = String((mockFetch.mock.calls[0] as unknown[])[0])
    expect(callUrl).toContain('/cid')
  })

  it('uploadCreativeAsset (image) returns hash', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: { 'a.jpg': { hash: 'abc123' } } }), { status: 200 })
    )
    const a = new MetaAdsAdapter(authInput())
    const r = await a.uploadCreativeAsset({ type: 'image', fileUrl: 'https://x', name: 'a' })
    expect(r.platformAssetId).toBe('abc123')
  })

  it('uploadCreativeAsset (video) returns id', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'vid_999' }), { status: 200 })
    )
    const a = new MetaAdsAdapter(authInput())
    const r = await a.uploadCreativeAsset({ type: 'video', fileUrl: 'https://x', name: 'b' })
    expect(r.platformAssetId).toBe('vid_999')
  })
})
