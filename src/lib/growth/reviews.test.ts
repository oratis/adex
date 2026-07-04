import { describe, it, expect } from 'vitest'
import { parseAppStoreReviews, fallbackClassify } from './reviews'

// Minimal App Store RSS JSON: a leading app-info entry (no im:rating) + reviews.
const feed = {
  feed: {
    entry: [
      { id: { label: 'appinfo' }, 'im:name': { label: 'Cuddler' } }, // no rating → skipped
      {
        id: { label: '1001' },
        'im:rating': { label: '1' },
        title: { label: 'Crashes constantly' },
        content: { label: 'The app crashed and I got charged for a refund I never got.' },
        updated: { label: '2026-07-03T10:00:00-07:00' },
      },
      {
        id: { label: '1002' },
        'im:rating': { label: '5' },
        title: { label: 'Love it' },
        content: { label: 'Amazing characters and the scenes are the best.' },
        updated: { label: '2026-07-02T10:00:00-07:00' },
      },
    ],
  },
}

describe('parseAppStoreReviews', () => {
  it('skips the app-info entry and parses reviews with a stable idempotent id', () => {
    const rows = parseAppStoreReviews(feed, { country: 'us' })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'app_store:us:1001', source: 'app_store', country: 'us', rating: 1 })
    expect(rows[0].reviewedAt.getTime()).toBeGreaterThan(0)
  })
  it('tolerates a single (non-array) entry and missing fields', () => {
    const one = { feed: { entry: { id: { label: 'x' }, 'im:rating': { label: '3' } } } }
    const rows = parseAppStoreReviews(one, { country: 'jp' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'app_store:jp:x', rating: 3, title: null, body: null })
  })
  it('returns [] on malformed input', () => {
    expect(parseAppStoreReviews(null, { country: 'us' })).toEqual([])
    expect(parseAppStoreReviews({ feed: {} }, { country: 'us' })).toEqual([])
  })
})

describe('fallbackClassify', () => {
  it('flags a 1-star crash+refund review as negative P0 with topics', () => {
    const c = fallbackClassify({ rating: 1, title: 'Crashes constantly', body: 'crashed and charged, want a refund' })
    expect(c.sentiment).toBe('negative')
    expect(c.priority).toBe('P0')
    expect(c.topics).toEqual(expect.arrayContaining(['crash', 'refund']))
  })
  it('classifies a 5-star review as positive P3 praise', () => {
    const c = fallbackClassify({ rating: 5, title: 'Love it', body: 'amazing, the best' })
    expect(c.sentiment).toBe('positive')
    expect(c.priority).toBe('P3')
    expect(c.topics).toContain('praise')
  })
  it('maps a 2-star non-critical review to P1 negative', () => {
    expect(fallbackClassify({ rating: 2, title: 'meh', body: 'confusing ui' }).priority).toBe('P1')
  })
  it('maps a 3-star review to neutral P2', () => {
    const c = fallbackClassify({ rating: 3, title: '', body: 'its okay' })
    expect(c.sentiment).toBe('neutral')
    expect(c.priority).toBe('P2')
  })
})
