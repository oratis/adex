import { describe, it, expect } from 'vitest'
import { getSpec, formatsForPlatform, validateCreative, ratioValue, type AssetMeta } from './creative-specs'

const tiktok = getSpec('tiktok', 'in_feed_9x16')!

describe('spec registry', () => {
  it('exposes specs by platform/format', () => {
    expect(tiktok.kind).toBe('video')
    expect(formatsForPlatform('meta').length).toBeGreaterThanOrEqual(2)
    expect(getSpec('nope', 'nope')).toBeUndefined()
  })
  it('ratioValue parses w:h', () => {
    expect(ratioValue('9:16')).toBeCloseTo(0.5625)
    expect(ratioValue('1:1')).toBe(1)
    expect(ratioValue('bad')).toBeNull()
  })
})

describe('validateCreative — TikTok in-feed', () => {
  const good: AssetMeta = { kind: 'video', width: 1080, height: 1920, durationSec: 12, fileSizeMB: 40, fileType: 'mp4' }

  it('conforms a clean 9:16 clip', () => {
    expect(validateCreative(good, tiktok)).toEqual({ status: 'conforms', issues: [] })
  })
  it('rejects the wrong kind outright', () => {
    expect(validateCreative({ ...good, kind: 'image' }, tiktok).status).toBe('rejected')
  })
  it('flags a landscape ratio as needs_resize', () => {
    const r = validateCreative({ ...good, width: 1920, height: 1080 }, tiktok)
    expect(r.status).toBe('needs_resize')
    expect(r.issues.join()).toContain('aspect')
  })
  it('flags an over-length / oversized clip as needs_transcode', () => {
    expect(validateCreative({ ...good, durationSec: 90 }, tiktok).status).toBe('needs_transcode')
    expect(validateCreative({ ...good, fileSizeMB: 600 }, tiktok).status).toBe('needs_transcode')
    expect(validateCreative({ ...good, fileType: 'webm' }, tiktok).status).toBe('needs_transcode')
  })
  it('transcode takes precedence over resize when both present', () => {
    // wrong ratio (resize) + too long (transcode) → transcode
    expect(validateCreative({ ...good, width: 1920, height: 1080, durationSec: 90 }, tiktok).status).toBe('needs_transcode')
  })
})

describe('validateCreative — Apple Search Ads', () => {
  it('is not_applicable (renders the App Store product page)', () => {
    const asa = getSpec('asa', 'search')!
    expect(validateCreative({ kind: 'text_only' }, asa).status).toBe('not_applicable')
  })
})
