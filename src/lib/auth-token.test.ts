import { afterEach, describe, expect, it, vi } from 'vitest'
import { signSessionToken, verifySessionToken } from './auth-token'

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('signed session boundary', () => {
  it('rejects raw user IDs, empty and malformed cookies', () => {
    vi.stubEnv('AUTH_TOKEN_SECRET', 'fixture-session-secret')
    for (const token of ['', 'cmexistinguser123456789012', 'not.a.token', 'broken.signature']) {
      expect(verifySessionToken(token)).toBeNull()
    }
  })
  it('preserves signed sessions and pre-session-table signed cookies', () => {
    vi.stubEnv('AUTH_TOKEN_SECRET', 'fixture-session-secret')
    expect(verifySessionToken(signSessionToken('fixture-user', 'fixture-session'))).toMatchObject({ uid: 'fixture-user', sid: 'fixture-session' })
    expect(verifySessionToken(signSessionToken('fixture-user'))).toMatchObject({ uid: 'fixture-user' })
  })
  it('rejects tampering and expiration', () => {
    vi.stubEnv('AUTH_TOKEN_SECRET', 'fixture-session-secret')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T00:00:00Z'))
    const token = signSessionToken('fixture-user', 'fixture-session', 60)
    const [, signature] = token.split('.')
    const otherPayload = Buffer.from(JSON.stringify({ uid: 'other-user', exp: 9999999999 })).toString('base64url')
    expect(verifySessionToken(`${otherPayload}.${signature}`)).toBeNull()
    vi.advanceTimersByTime(61_000)
    expect(verifySessionToken(token)).toBeNull()
  })
  it('fails closed with no signing secret', () => {
    vi.stubEnv('AUTH_TOKEN_SECRET', '')
    vi.stubEnv('NEXTAUTH_SECRET', '')
    expect(() => signSessionToken('fixture-user')).toThrow('AUTH_TOKEN_SECRET')
    expect(verifySessionToken('payload.signature')).toBeNull()
  })
})
