import { prisma } from '@/lib/prisma'

export function requireString(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') throw new Error(`Expected object input`)
  const v = (input as Record<string, unknown>)[key]
  if (typeof v !== 'string' || v.length === 0)
    throw new Error(`Missing or invalid ${key} (must be non-empty string)`)
  return v
}

export function requireNumber(input: unknown, key: string): number {
  if (!input || typeof input !== 'object') throw new Error(`Expected object input`)
  const v = (input as Record<string, unknown>)[key]
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new Error(`Missing or invalid ${key} (must be finite number)`)
  return v
}

export function optionalString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const v = (input as Record<string, unknown>)[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export async function getOwnedCampaign(orgId: string, campaignId: string) {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId, orgId } })
  if (!c) throw new Error(`Campaign ${campaignId} not found in org ${orgId}`)
  return c
}
