import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'
function key() {
  const encoded = process.env.PLATFORM_CREDENTIAL_KEY || ''
  const value = Buffer.from(encoded, 'base64')
  if (value.length !== 32 || value.toString('base64') !== encoded)
    throw new Error(
      'Configure PLATFORM_CREDENTIAL_KEY with a base64-encoded 32-byte key',
    )
  return value
}

export function sealCredential(value: string, scope: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), nonce)
  cipher.setAAD(Buffer.from(scope))
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  return (
    PREFIX +
    Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64')
  )
}

export function openCredential(value: string, scope: string): string {
  // Existing connections are migrated when their token is replaced in setup.
  if (!value.startsWith('enc:')) return value
  if (!value.startsWith(PREFIX))
    throw new Error('Unsupported credential format')
  const payload = Buffer.from(value.slice(PREFIX.length), 'base64')
  if (payload.length < 29) throw new Error('Invalid encrypted credential')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    payload.subarray(0, 12),
  )
  decipher.setAAD(Buffer.from(scope))
  decipher.setAuthTag(payload.subarray(12, 28))
  return Buffer.concat([
    decipher.update(payload.subarray(28)),
    decipher.final(),
  ]).toString('utf8')
}
