import { describe, it, expect } from 'vitest'
import { mapSceneToCreative, fallbackTags, parseScenes } from './scene-import'

describe('mapSceneToCreative', () => {
  it('maps a scene to a review-gated imported_scene Creative', () => {
    const c = mapSceneToCreative(
      { id: 'scene_1', url: 'https://x/s1.mp4', prompt: 'anime girl on a beach, cozy', width: 1080, height: 1920, durationSec: 5 },
      { orgId: 'org1', userId: 'u1' },
      ['anime', 'cozy'],
    )
    expect(c).toMatchObject({
      orgId: 'org1', userId: 'u1', type: 'video', source: 'imported_scene',
      sourceRef: 'scene_1', fileUrl: 'https://x/s1.mp4', reviewStatus: 'pending',
      width: 1080, height: 1920, duration: 5,
    })
    expect(c.tags).toBe(JSON.stringify(['anime', 'cozy']))
  })
  it('names from prompt (truncated) and tolerates missing fields', () => {
    const c = mapSceneToCreative({ id: 's2', url: 'u' }, { orgId: 'o', userId: 'u' })
    expect(c.name).toBe('Scene s2')
    expect(c.tags).toBeNull()
    expect(c.width).toBeNull()
  })
})

describe('fallbackTags', () => {
  it('merges character tags with style/emotion keywords from the prompt', () => {
    const t = fallbackTags({ id: 's', url: 'u', prompt: 'a romantic cinematic scene', characterTags: ['Yuki'] })
    expect(t).toEqual(expect.arrayContaining(['yuki', 'romantic', 'cinematic']))
  })
})

describe('parseScenes', () => {
  it('parses an envelope and drops entries without id/url', () => {
    const out = parseScenes({ scenes: [{ id: 'a', url: 'ua' }, { id: 'b' }, { url: 'uc' }] })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
  })
  it('accepts a bare array', () => {
    expect(parseScenes([{ id: 'a', url: 'u' }])).toHaveLength(1)
  })
})
