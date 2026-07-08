import { describe, it, expect } from 'vitest'
import {
  extForContentType,
  competitorMediaKey,
  assertStorable,
  THUMBNAIL_MAX_BYTES,
} from './competitor-media'

describe('extForContentType', () => {
  it('maps known types and ignores charset params', () => {
    expect(extForContentType('image/jpeg')).toBe('jpg')
    expect(extForContentType('image/png')).toBe('png')
    expect(extForContentType('video/mp4; codecs=avc1')).toBe('mp4')
  })
  it('falls back to bin for unknown types', () => {
    expect(extForContentType('application/octet-stream')).toBe('bin')
  })
})

describe('competitorMediaKey', () => {
  it('builds a deterministic, tier-scoped path with the right extension', () => {
    expect(competitorMediaKey('org1', 'talkie-202', 'thumbnail', 'image/jpeg')).toBe(
      'competitors/org1/thumbnail/talkie-202.jpg',
    )
  })
  it('sanitises externalId so it cannot escape the path', () => {
    const key = competitorMediaKey('org1', '../../etc/passwd', 'poster', 'image/png')
    expect(key).toBe('competitors/org1/poster/______etc_passwd.png')
    expect(key).not.toContain('..')
  })
  it('is stable across calls (same input → same key → overwrite, not duplicate)', () => {
    const a = competitorMediaKey('o', 'e', 'thumbnail', 'image/webp')
    const b = competitorMediaKey('o', 'e', 'thumbnail', 'image/webp')
    expect(a).toBe(b)
  })
})

describe('assertStorable (Tier policy)', () => {
  it('allows an in-cap image thumbnail', () => {
    expect(() => assertStorable('thumbnail', 'image/jpeg', 200_000)).not.toThrow()
  })
  it('rejects an oversized preview image', () => {
    expect(() => assertStorable('poster', 'image/png', THUMBNAIL_MAX_BYTES + 1)).toThrow(/cap/)
  })
  it('rejects a non-image under an image tier', () => {
    expect(() => assertStorable('thumbnail', 'video/mp4', 1000)).toThrow(/images only/)
  })
  it('rejects video by default (ToS/IP gate)', () => {
    expect(() => assertStorable('video', 'video/mp4', 5_000_000)).toThrow(/disabled by default/)
  })
  it('allows video only when explicitly opted in and content-type is video', () => {
    expect(() => assertStorable('video', 'video/mp4', 5_000_000, true)).not.toThrow()
    expect(() => assertStorable('video', 'image/png', 1000, true)).toThrow(/video content-type/)
  })
})
