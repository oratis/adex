import { describe, it, expect } from 'vitest'
import { signWebhookBody, generateWebhookSecret, nextAttemptDelay } from './webhooks'

describe('signWebhookBody', () => {
  it('produces deterministic sha256 hex', () => {
    const sig = signWebhookBody('s3cret', 'hello')
    expect(sig.startsWith('sha256=')).toBe(true)
    // SHA-256 hex is 64 chars
    expect(sig.length).toBe('sha256='.length + 64)
    expect(signWebhookBody('s3cret', 'hello')).toBe(sig)
  })
  it('different secret → different signature', () => {
    expect(signWebhookBody('a', 'x')).not.toBe(signWebhookBody('b', 'x'))
  })
})

describe('generateWebhookSecret', () => {
  it('starts with whsec_ and is reasonable length', () => {
    const s = generateWebhookSecret()
    expect(s.startsWith('whsec_')).toBe(true)
    expect(s.length).toBeGreaterThan(20)
  })
  it('is unique per call', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret())
  })
})

describe('nextAttemptDelay', () => {
  it('grows with attempt index', () => {
    const ds = [0, 1, 2, 3, 4].map(nextAttemptDelay)
    for (let i = 1; i < ds.length; i++) {
      expect(ds[i]).toBeGreaterThan(ds[i - 1])
    }
  })
  it('plateaus at the largest delay', () => {
    expect(nextAttemptDelay(10)).toBe(nextAttemptDelay(4))
  })
})
