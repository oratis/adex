import crypto from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { verifySlackSignature } from './slack-signature'

const SECRET = 'test-secret-do-not-use-in-prod'

function signed(body: string, ts: string, secret = SECRET): string {
  const base = `v0:${ts}:${body}`
  return `v0=${crypto.createHmac('sha256', secret).update(base).digest('hex')}`
}

describe('verifySlackSignature (audit Critical #5)', () => {
  const now = 1_700_000_000

  it('accepts a fresh, correctly-signed request', () => {
    const body = 'payload=%7B%7D'
    const ts = String(now)
    const sig = signed(body, ts)
    expect(
      verifySlackSignature({ secret: SECRET, timestamp: ts, signature: sig, rawBody: body, now })
    ).toBe(true)
  })

  it('rejects when secret is unset', () => {
    const body = 'x'
    const ts = String(now)
    const sig = signed(body, ts)
    expect(
      verifySlackSignature({ secret: undefined, timestamp: ts, signature: sig, rawBody: body, now })
    ).toBe(false)
  })

  it('rejects when timestamp header is missing', () => {
    const body = 'x'
    const sig = signed(body, String(now))
    expect(
      verifySlackSignature({ secret: SECRET, timestamp: null, signature: sig, rawBody: body, now })
    ).toBe(false)
  })

  it('rejects NaN timestamp (Critical #5 regression guard)', () => {
    // The pre-fix code did `Number('not-a-number') > 300` which is false,
    // so an attacker could supply garbage and bypass the age check.
    const body = 'x'
    const ts = 'not-a-number'
    const sig = signed(body, ts)
    expect(
      verifySlackSignature({ secret: SECRET, timestamp: ts, signature: sig, rawBody: body, now })
    ).toBe(false)
  })

  it('rejects timestamps older than 5 minutes', () => {
    const body = 'x'
    const ts = String(now - 301)
    const sig = signed(body, ts)
    expect(
      verifySlackSignature({ secret: SECRET, timestamp: ts, signature: sig, rawBody: body, now })
    ).toBe(false)
  })

  it('rejects timestamps more than 5 minutes in the future', () => {
    const body = 'x'
    const ts = String(now + 600)
    const sig = signed(body, ts)
    expect(
      verifySlackSignature({ secret: SECRET, timestamp: ts, signature: sig, rawBody: body, now })
    ).toBe(false)
  })

  it('rejects a bad signature', () => {
    const body = 'x'
    const ts = String(now)
    const sig = signed(body, ts, 'wrong-secret')
    expect(
      verifySlackSignature({ secret: SECRET, timestamp: ts, signature: sig, rawBody: body, now })
    ).toBe(false)
  })

  it('rejects mismatched signature length without throwing', () => {
    const body = 'x'
    const ts = String(now)
    expect(
      verifySlackSignature({
        secret: SECRET,
        timestamp: ts,
        signature: 'v0=short',
        rawBody: body,
        now,
      })
    ).toBe(false)
  })

  it('rejects when body is tampered after signing', () => {
    const body = 'payload=%7B%22action%22%3A%22approve%22%7D'
    const ts = String(now)
    const sig = signed(body, ts)
    expect(
      verifySlackSignature({
        secret: SECRET,
        timestamp: ts,
        signature: sig,
        rawBody: body + '&extra=1',
        now,
      })
    ).toBe(false)
  })
})
