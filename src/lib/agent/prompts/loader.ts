import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'

const cache = new Map<string, string>()

/**
 * Load a prompt template.
 *
 * Resolution order, when an `orgId` is supplied:
 *   1. Pick the active *experimental* version for `name` (if any) and the
 *      org's stable hash mod 100 falls within `experimentalSharePct`.
 *   2. Otherwise pick the `isDefault=true` version for `name`.
 *   3. Otherwise fall back to the disk template (development convenience).
 *
 * orgId-based hashing means the same org always sees the same prompt within
 * a release — no flip-flopping per cycle. To roll out a new prompt, write a
 * row with `isExperimental=true, experimentalSharePct=10` and ramp the share.
 */
export async function loadPrompt(
  name: string,
  orgId?: string
): Promise<{ id: string; template: string; model?: string; isExperimental: boolean }> {
  // Try DB-backed experimental first when orgId is known.
  try {
    if (orgId) {
      const experimental = await prisma.promptVersion.findFirst({
        where: { name, isExperimental: true },
        orderBy: { version: 'desc' },
      })
      if (experimental && experimental.experimentalSharePct > 0) {
        const bucket = orgBucket(orgId, name)
        if (bucket < experimental.experimentalSharePct) {
          return {
            id: experimental.id,
            template: experimental.template,
            model: experimental.model,
            isExperimental: true,
          }
        }
      }
    }
    const def = await prisma.promptVersion.findFirst({
      where: { name, isDefault: true },
      orderBy: { version: 'desc' },
    })
    if (def) {
      return {
        id: def.id,
        template: def.template,
        model: def.model,
        isExperimental: false,
      }
    }
  } catch {
    // table may not exist in dev; fall through
  }
  const fileMap: Record<string, string> = {
    'agent.plan': 'plan.v1.md',
  }
  const file = fileMap[name]
  if (!file) throw new Error(`Unknown prompt "${name}"`)
  const cached = cache.get(name)
  if (cached) return { id: `disk:${name}@v1`, template: cached, isExperimental: false }
  const fullPath = path.join(process.cwd(), 'src', 'lib', 'agent', 'prompts', file)
  const template = await readFile(fullPath, 'utf-8')
  cache.set(name, template)
  return { id: `disk:${name}@v1`, template, isExperimental: false }
}

/**
 * Stable bucket assignment in [0, 100). Hash on `${orgId}:${promptName}` so
 * different prompts can have independent A/B splits without correlated
 * exposure. Pure SHA-256 → first 8 hex chars → uint32 → mod 100.
 */
export function orgBucket(orgId: string, promptName: string): number {
  const hex = crypto.createHash('sha256').update(`${orgId}:${promptName}`).digest('hex')
  const n = parseInt(hex.slice(0, 8), 16)
  return n % 100
}

export function renderPrompt(template: string, vars: Record<string, string>): string {
  let out = template
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v)
  }
  return out
}
