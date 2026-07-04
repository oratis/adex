/**
 * DCO variant matrix (pure). A brief fans out into variant cells across
 * platform × format × hook × language — the IAB Dynamic Content Ads idea
 * (a base creative with swappable slots). The matrix is capped so a broad
 * brief can't explode into thousands of cells; truncation is reported, never
 * silent.
 *
 * Ref: docs/growth/03-creative-studio.md
 */

import { formatsForPlatform } from './creative-specs'

export interface VariantPlan {
  platform: string
  format: string
  hook: string
  language: string
}

export interface BriefInput {
  platforms: string[]
  hooks?: string[]
  languages?: string[]
}

export interface MatrixResult {
  variants: VariantPlan[]
  total: number // total before cap
  truncated: boolean
}

export const DEFAULT_MAX_VARIANTS = 40

/**
 * Enumerate the variant matrix for a brief. Unknown platforms (no specs) are
 * skipped. Dedupes identical cells and caps at `maxVariants`.
 */
export function buildVariantMatrix(brief: BriefInput, opts: { maxVariants?: number } = {}): MatrixResult {
  const maxVariants = opts.maxVariants ?? DEFAULT_MAX_VARIANTS
  const hooks = brief.hooks && brief.hooks.length ? brief.hooks : ['default']
  const languages = brief.languages && brief.languages.length ? brief.languages : ['en']

  const seen = new Set<string>()
  const all: VariantPlan[] = []
  for (const platform of brief.platforms) {
    const specs = formatsForPlatform(platform)
    for (const spec of specs) {
      for (const hook of hooks) {
        for (const language of languages) {
          const key = `${platform}|${spec.format}|${hook}|${language}`
          if (seen.has(key)) continue
          seen.add(key)
          all.push({ platform, format: spec.format, hook, language })
        }
      }
    }
  }

  return {
    variants: all.slice(0, maxVariants),
    total: all.length,
    truncated: all.length > maxVariants,
  }
}
