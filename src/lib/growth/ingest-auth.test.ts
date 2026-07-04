import crypto from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { verifyBearer, readBearer, verifyHmac } from './ingest-auth'

const SECRET = 'ingest-secret-not-for-prod'

describe('verifyBearer', () => {
  it('accepts an exact match', () => {
    expect(verifyBearer(SECRET, SECRET)).toBe(true)
  })
  it('rejects mismatch, empty, and undefined', () => {
    expect(verifyBearer('wrong', SECRET)).toBe(false)
    expect(verifyBearer('', SECRET)).toBe(false)
    expect(verifyBearer(SECRET, undefined)).toBe(false)
    expect(verifyBearer(null, SECRET)).toBe(false)
  })
  it('rejects a length mismatch without throwing', () => {
    expect(verifyBearer('short', SECRET)).toBe(false)
  })
})

describe('readBearer', () => {
  it('strips a Bearer prefix case-insensitively', () => {
    expect(readBearer('Bearer abc123')).toBe('abc123')
    expect(readBearer('bearer  abc123')).toBe('abc123')
    expect(readBearer('abc123')).toBe('abc123')
  })
  it('returns null for empty/absent', () => {
    expect(readBearer(null)).toBeNull()
    expect(readBearer('Bearer   ')).toBeNull()
  })
})

describe('verifyHmac', () => {
  const now = 1_700_000_000
  const body = '{"event":"x"}'
  function sign(ts: string, rawBody: string, secret = SECRET): string {
    return `sha256=${crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex')}`
  }

  it('accepts a fresh, correctly-signed request', () => {
    const ts = String(now)
    expect(verifyHmac({ secret: SECRET, timestamp: ts, signature: sign(ts, body), rawBody: body, now })).toBe(true)
  })
  it('rejects a stale timestamp (replay window)', () => {
    const ts = String(now - 10_000)
    expect(verifyHmac({ secret: SECRET, timestamp: ts, signature: sign(ts, body), rawBody: body, now })).toBe(false)
  })
  it('rejects a tampered body', () => {
    const ts = String(now)
    const sig = sign(ts, body)
    expect(verifyHmac({ secret: SECRET, timestamp: ts, signature: sig, rawBody: body + 'x', now })).toBe(false)
  })
  it('rejects a non-finite timestamp without bypassing the age check', () => {
    expect(verifyHmac({ secret: SECRET, timestamp: 'not-a-number', signature: sign('x', body), rawBody: body, now })).toBe(false)
    expect(verifyHmac({ secret: SECRET, timestamp: undefined, signature: 'sha256=x', rawBody: body, now })).toBe(false)
  })
  it('rejects when secret missing', () => {
    const ts = String(now)
    expect(verifyHmac({ secret: undefined, timestamp: ts, signature: sign(ts, body), rawBody: body, now })).toBe(false)
  })
})
