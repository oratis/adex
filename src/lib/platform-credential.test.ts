import { afterEach, describe, expect, it, vi } from 'vitest'
import { sealCredential, openCredential } from './platform-credential'

afterEach(() => vi.unstubAllEnvs())
describe('platform credential storage', () => {
  it('encrypts with random nonces, authenticates scope and rejects tampering', () => {
    vi.stubEnv(
      'PLATFORM_CREDENTIAL_KEY',
      Buffer.alloc(32, 7).toString('base64'),
    )
    const encrypted = sealCredential('fixture-secret', 'org-a:adjust')
    expect(encrypted).not.toContain('fixture-secret')
    expect(encrypted).not.toBe(sealCredential('fixture-secret', 'org-a:adjust'))
    expect(openCredential(encrypted, 'org-a:adjust')).toBe('fixture-secret')
    expect(() => openCredential(encrypted, 'org-b:adjust')).toThrow()
    expect(() =>
      openCredential(encrypted.slice(0, -4) + 'AAAA', 'org-a:adjust'),
    ).toThrow()
  })
  it('fails closed without a dedicated valid encryption key', () => {
    vi.stubEnv('PLATFORM_CREDENTIAL_KEY', '')
    expect(() => sealCredential('fixture', 'org-a:adjust')).toThrow(
      'PLATFORM_CREDENTIAL_KEY',
    )
    vi.stubEnv('PLATFORM_CREDENTIAL_KEY', 'short')
    expect(() => sealCredential('fixture', 'org-a:adjust')).toThrow(
      'PLATFORM_CREDENTIAL_KEY',
    )
  })
  it('reads existing plaintext connections only for compatibility; new writes are encrypted', () => {
    expect(openCredential('legacy-fixture', 'org-a:adjust')).toBe(
      'legacy-fixture',
    )
  })
})
