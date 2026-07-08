/**
 * Competitor creative → differentiated "remix" brief (pure, LLM-optional).
 *
 * Turns a competitor creative's *analysis* (selling points, emotional triggers,
 * format, hook) into a brief for OUR product. The output is a text2video prompt
 * + storyboard + copy that a caller feeds to `POST /api/seedance2/generate` and
 * lands as a review-gated `Creative(source:'remix')`.
 *
 * Design principle — "derive, don't copy": reuse only ad-engineering STRUCTURE
 * (format, hook mechanic, pacing, selling-point *themes*). NEVER reproduce the
 * competitor's characters, brand, logo, art direction, copy, or music — the
 * competitor's `screenUnderstanding` is treated as an ANTI-reference (what not
 * to depict). Output is always our product's original IP. Enforced in both the
 * LLM system prompt and the deterministic fallback, and asserted in `compliance`.
 *
 * Ref: docs/growth/06-competitor-intel-remix.md §3.2 · docs/growth/06-poc-run-01.md
 */

import { completeJSON, isLLMConfigured } from '@/lib/llm'

export type Ratio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4'

/** Analysis subset of a CompetitorCreative — the structure a remix may borrow from. */
export interface CompetitorAnalysis {
  externalId: string
  app?: string | null
  headline?: string | null
  ratio?: Ratio | null
  durationSec?: number | null
  format?: string | null // e.g. "Vertical Video / Rewarded"
  creativeTags?: string[] | null
  sellingPoints?: string[] | null
  emotionalTriggers?: string[] | null
  /** Competitor's own visual specifics — used ONLY as anti-reference (never reproduced). */
  screenUnderstanding?: string[] | null
  audienceProfile?: string | null
}

/** Our product — the IP/brand/positioning the remix must express (never the competitor's). */
export interface ProductBrief {
  product: string // "Cuddler"
  positioning: string // "an AI companion who's always there"
  audience: string // "18-28, lonely late nights, ex-Character-AI"
  artDirection: string // "warm cozy 2.5D animation, amber & dusk-blue palette"
  cta: string // "Meet yours"
  differentiation?: string | null // explicit counter-angle vs the competitor
  forbidden?: string[] | null // elements never to reproduce (competitor IP/brand)
}

export interface StoryboardBeat {
  role: 'hook' | 'scene' | 'end-card'
  seconds: number
  description: string
}

export interface RemixBrief {
  sourceRef: string // competitor externalId (provenance)
  borrowed: string[] // ad-engineering structure reused (not IP)
  changed: string[] // what was swapped to our IP
  hookText: string // our hook line (never the competitor's)
  storyboard: StoryboardBeat[]
  seedance2Prompt: string // text2video, our IP, no competitor pixels
  ratio: Ratio
  durationSec: number
  copy: { headline: string; primaryText: string; cta: string }
  compliance: {
    deriveNotCopy: true
    reusesCompetitorIP: false
    reviewStatus: 'pending'
    notes: string
  }
}

const VALID_RATIOS: Ratio[] = ['16:9', '9:16', '1:1', '4:3', '3:4']

function coerceRatio(r: unknown): Ratio | null {
  return typeof r === 'string' && (VALID_RATIOS as string[]).includes(r) ? (r as Ratio) : null
}

/** Seedance2 clips are short — keep remix duration in a sane render window. */
function clampDuration(d: number | null | undefined): number {
  if (typeof d !== 'number' || !Number.isFinite(d)) return 8
  return Math.max(5, Math.min(10, Math.round(d)))
}

function orientationWord(ratio: Ratio): string {
  if (ratio === '9:16' || ratio === '3:4') return 'Vertical'
  if (ratio === '16:9' || ratio === '4:3') return 'Horizontal'
  return 'Square'
}

function cleanList(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x)).filter(Boolean).slice(0, max)
}

/**
 * Deterministic, LLM-free remix brief. Borrows the competitor's format + hook
 * mechanic + selling-point *themes*; expresses everything through our product's
 * IP. Never emits the competitor's `screenUnderstanding` specifics. Never throws.
 */
export function deterministicRemixBrief(c: CompetitorAnalysis, p: ProductBrief): RemixBrief {
  const ratio = coerceRatio(c.ratio) ?? '9:16'
  const durationSec = clampDuration(c.durationSec)
  const themes = cleanList(c.sellingPoints, 4)
  const emotions = cleanList(c.emotionalTriggers, 3)

  const hookText = `${p.product.toUpperCase()}?` // safe, our-brand hook; LLM path writes a sharper one

  const borrowed = [
    `format archetype (${orientationWord(ratio).toLowerCase()} ${ratio}, sound-on, ~${durationSec}s)`,
    'first-frame hook mechanic (short overlay line over a character close-up)',
    'category value-prop framing ("your ideal companion")',
    themes.length ? `selling-point themes: ${themes.join(', ')}` : 'single-character intimacy structure',
  ]

  const changed = [
    `original character + art direction (${p.artDirection})`,
    `positioning (${p.positioning}) — not the competitor's`,
    'our brand, logo, copy, CTA and music',
    c.screenUnderstanding?.length
      ? 'dropped the competitor\'s specific on-screen elements (used only as anti-reference)'
      : 'no competitor visual elements reused',
  ]

  const sceneSecs = Math.max(3, durationSec - 5)
  const storyboard: StoryboardBeat[] = [
    { role: 'hook', seconds: 3, description: `${p.product} original character in close-up; overlay hook "${hookText}"` },
    {
      role: 'scene',
      seconds: sceneSecs,
      description: `The character embodies "${p.positioning}", looking warmly into camera; soft chat bubbles drift up${emotions.length ? ` (emotional register: ${emotions.join(', ')})` : ''}`,
    },
    { role: 'end-card', seconds: 2, description: `${p.product} logo + tagline; CTA "${p.cta}"` },
  ]

  const seedance2Prompt = [
    `${orientationWord(ratio)} ${ratio} cinematic short, sound on.`,
    `${p.artDirection}.`,
    `A single original character embodying "${p.positioning}", looking warmly into the camera as if greeting someone they care about.`,
    'Soft rounded chat bubbles drift gently upward beside them. Slow intimate camera.',
    'No on-screen text, no logos, no third-party or competitor characters — original IP only.',
  ].join(' ')

  return {
    sourceRef: c.externalId,
    borrowed,
    changed,
    hookText,
    storyboard,
    seedance2Prompt,
    ratio,
    durationSec,
    copy: {
      headline: p.positioning,
      primaryText: `${p.differentiation ? p.differentiation + ' ' : ''}Meet your ${p.product} — for ${p.audience}.`.trim(),
      cta: p.cta,
    },
    compliance: {
      deriveNotCopy: true,
      reusesCompetitorIP: false,
      reviewStatus: 'pending',
      notes: 'Borrows ad-engineering structure only; output is original product IP; human review gates any push.',
    },
  }
}

/** What the LLM is asked to author (safety-critical fields are forced server-side, not trusted). */
interface LLMRemixCreative {
  hookText?: unknown
  borrowed?: unknown
  changed?: unknown
  seedance2Prompt?: unknown
  storyboard?: unknown
  copy?: { headline?: unknown; primaryText?: unknown; cta?: unknown }
}

const REMIX_SYSTEM =
  'You are an ad-creative strategist. You get a COMPETITOR ad\'s structural analysis and OUR product brief. ' +
  'Produce a brief for OUR product that borrows ONLY ad-engineering STRUCTURE from the competitor — format, hook ' +
  'mechanic, pacing, and selling-point THEMES — expressed entirely through OUR product\'s original IP.\n' +
  'HARD RULES (legal + brand safety):\n' +
  '- NEVER reproduce the competitor\'s characters, character descriptions, brand, logo, art style, copy lines, or music.\n' +
  '- Treat the competitor\'s screenUnderstanding as an ANTI-reference: what NOT to depict.\n' +
  '- Depict ONLY our product\'s original IP. No third-party characters/logos/trademarks. No on-screen text except our own hook line.\n' +
  '- Honor every item in the product\'s "forbidden" list.\n' +
  '- The video prompt is text-to-video (no competitor footage).\n' +
  'Return JSON {hookText, borrowed:[], changed:[], seedance2Prompt, storyboard:[{role,seconds,description}], copy:{headline,primaryText,cta}}.'

function coerceStoryboard(v: unknown, fallback: StoryboardBeat[]): StoryboardBeat[] {
  if (!Array.isArray(v)) return fallback
  const roles = new Set(['hook', 'scene', 'end-card'])
  const out: StoryboardBeat[] = []
  for (const b of v) {
    if (!b || typeof b !== 'object') continue
    const r = (b as { role?: unknown }).role
    const s = (b as { seconds?: unknown }).seconds
    const d = (b as { description?: unknown }).description
    if (typeof r === 'string' && roles.has(r) && typeof d === 'string') {
      out.push({ role: r as StoryboardBeat['role'], seconds: typeof s === 'number' ? s : 0, description: d })
    }
  }
  return out.length ? out : fallback
}

/**
 * Build a remix brief — Claude authors the creative fields when configured, else
 * the deterministic template. Safety-critical fields (`sourceRef`, `ratio`,
 * `durationSec`, `compliance`) are always forced here, never taken from the LLM.
 * Never throws (falls back on any error).
 */
export async function buildRemixBrief(
  c: CompetitorAnalysis,
  p: ProductBrief,
  opts: { temperature?: number } = {},
): Promise<RemixBrief> {
  const base = deterministicRemixBrief(c, p)
  if (!isLLMConfigured()) return base

  try {
    const user =
      `COMPETITOR (structure to borrow; screenUnderstanding is anti-reference):\n` +
      JSON.stringify({
        app: c.app ?? undefined,
        format: c.format ?? undefined,
        ratio: base.ratio,
        sellingPoints: cleanList(c.sellingPoints),
        emotionalTriggers: cleanList(c.emotionalTriggers),
        screenUnderstanding_DO_NOT_COPY: cleanList(c.screenUnderstanding),
        audience: c.audienceProfile ?? undefined,
      }) +
      `\n\nOUR PRODUCT:\n` +
      JSON.stringify(p) +
      `\n\nTarget: ${base.ratio}, ${base.durationSec}s, text-to-video.`

    const llm = await completeJSON<LLMRemixCreative>(user, {
      system: REMIX_SYSTEM,
      maxTokens: 900,
      temperature: opts.temperature ?? 0.7,
    })

    const copy = llm.copy && typeof llm.copy === 'object' ? llm.copy : {}
    return {
      ...base, // keeps forced sourceRef / ratio / durationSec / compliance
      hookText: typeof llm.hookText === 'string' && llm.hookText.trim() ? llm.hookText.trim() : base.hookText,
      borrowed: cleanList(llm.borrowed).length ? cleanList(llm.borrowed) : base.borrowed,
      changed: cleanList(llm.changed).length ? cleanList(llm.changed) : base.changed,
      seedance2Prompt:
        typeof llm.seedance2Prompt === 'string' && llm.seedance2Prompt.trim() ? llm.seedance2Prompt.trim() : base.seedance2Prompt,
      storyboard: coerceStoryboard(llm.storyboard, base.storyboard),
      copy: {
        headline: typeof copy.headline === 'string' && copy.headline.trim() ? copy.headline.trim() : base.copy.headline,
        primaryText: typeof copy.primaryText === 'string' && copy.primaryText.trim() ? copy.primaryText.trim() : base.copy.primaryText,
        cta: typeof copy.cta === 'string' && copy.cta.trim() ? copy.cta.trim() : base.copy.cta,
      },
    }
  } catch {
    return base
  }
}

/** Turn a remix brief into the exact `POST /api/seedance2/generate` body (text2video, IP-safe). */
export function remixBriefToSeedanceRequest(brief: RemixBrief, name?: string) {
  return {
    name: name ?? `Remix — ${brief.sourceRef}`,
    mode: 'text2video' as const,
    prompt: brief.seedance2Prompt,
    ratio: brief.ratio,
    duration: brief.durationSec,
    generateAudio: true,
  }
}

/** Structural shape of a persisted CompetitorCreative row (Prisma `Json` fields arrive as `unknown`). */
export interface CompetitorCreativeRow {
  externalId: string
  appName?: string | null
  adFormat?: string | null
  ratio?: string | null
  duration?: number | null
  creativeTags?: unknown
  sellingPoints?: unknown
  emotionalTriggers?: unknown
  screenUnderstanding?: unknown
}

/**
 * Map a persisted CompetitorCreative row → CompetitorAnalysis for the remix.
 * Decoupled from Prisma (structural input); coerces JSON fields to string[] and
 * an unknown ratio to null. `screenUnderstanding` is carried only as the
 * anti-reference — `buildRemixBrief` never reproduces it.
 */
export function competitorCreativeToAnalysis(row: CompetitorCreativeRow): CompetitorAnalysis {
  return {
    externalId: row.externalId,
    app: row.appName ?? null,
    headline: null,
    ratio: coerceRatio(row.ratio),
    durationSec: typeof row.duration === 'number' ? row.duration : null,
    format: row.adFormat ?? null,
    creativeTags: cleanList(row.creativeTags),
    sellingPoints: cleanList(row.sellingPoints),
    emotionalTriggers: cleanList(row.emotionalTriggers),
    screenUnderstanding: cleanList(row.screenUnderstanding),
    audienceProfile: null,
  }
}

/** Parse an inbound competitor-analysis payload; returns null if it lacks an externalId. */
export function parseCompetitorAnalysis(raw: unknown): CompetitorAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const externalId = typeof o.externalId === 'string' ? o.externalId : null
  if (!externalId) return null
  return {
    externalId,
    app: typeof o.app === 'string' ? o.app : null,
    headline: typeof o.headline === 'string' ? o.headline : null,
    ratio: coerceRatio(o.ratio),
    durationSec: typeof o.durationSec === 'number' ? o.durationSec : null,
    format: typeof o.format === 'string' ? o.format : null,
    creativeTags: Array.isArray(o.creativeTags) ? cleanList(o.creativeTags) : null,
    sellingPoints: Array.isArray(o.sellingPoints) ? cleanList(o.sellingPoints) : null,
    emotionalTriggers: Array.isArray(o.emotionalTriggers) ? cleanList(o.emotionalTriggers) : null,
    screenUnderstanding: Array.isArray(o.screenUnderstanding) ? cleanList(o.screenUnderstanding) : null,
    audienceProfile: typeof o.audienceProfile === 'string' ? o.audienceProfile : null,
  }
}
