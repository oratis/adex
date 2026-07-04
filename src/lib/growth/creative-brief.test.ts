import { describe, it, expect } from 'vitest'
import { buildVariantMatrix } from './creative-brief'
import { buildStoryboard } from './storyboard'

describe('buildVariantMatrix — DCO fan-out', () => {
  it('enumerates platform × format × hook × language', () => {
    const r = buildVariantMatrix({ platforms: ['tiktok'], hooks: ['a', 'b'], languages: ['en', 'ja'] })
    // tiktok has 1 format × 2 hooks × 2 languages = 4
    expect(r.variants).toHaveLength(4)
    expect(r.truncated).toBe(false)
    expect(new Set(r.variants.map((v) => `${v.hook}|${v.language}`)).size).toBe(4)
  })
  it('expands multiple platforms by their formats', () => {
    // meta has 2 formats, tiktok 1, asa 1 → 4 cells at default hook/lang
    const r = buildVariantMatrix({ platforms: ['meta', 'tiktok', 'asa'] })
    expect(r.total).toBe(4)
  })
  it('skips unknown platforms', () => {
    expect(buildVariantMatrix({ platforms: ['nope'] }).total).toBe(0)
  })
  it('caps and reports truncation', () => {
    const r = buildVariantMatrix({ platforms: ['meta'], hooks: ['a', 'b', 'c'], languages: ['en', 'ja', 'ko'] }, { maxVariants: 5 })
    // meta 2 formats × 3 hooks × 3 langs = 18 → capped to 5
    expect(r.total).toBe(18)
    expect(r.variants).toHaveLength(5)
    expect(r.truncated).toBe(true)
  })
  it('dedupes identical cells', () => {
    const r = buildVariantMatrix({ platforms: ['tiktok'], hooks: ['x', 'x'] })
    expect(r.variants).toHaveLength(1)
  })
})

describe('buildStoryboard', () => {
  it('composes hook → scene → end-card with cumulative timings', () => {
    const sb = buildStoryboard({ product: 'Cuddler', hook: 'chat becomes film', cta: 'Play now' })
    expect(sb.segments.map((s) => s.role)).toEqual(['hook', 'scene', 'end_card'])
    expect(sb.segments[0].startSec).toBe(0)
    expect(sb.segments[1].startSec).toBe(3)
    expect(sb.segments[2].startSec).toBe(8)
    expect(sb.totalSec).toBe(11)
  })
  it('uses a scene ref for the scene segment (no prompt)', () => {
    const sb = buildStoryboard({ product: 'Cuddler', sceneRef: 'scene_123' })
    const scene = sb.segments.find((s) => s.role === 'scene')!
    expect(scene.sourceRef).toBe('scene_123')
    expect(scene.prompt).toBeUndefined()
  })
  it('drops zero-duration segments', () => {
    const sb = buildStoryboard({ product: 'Cuddler', hookSec: 0, endCardSec: 0 })
    expect(sb.segments.map((s) => s.role)).toEqual(['scene'])
  })
})
