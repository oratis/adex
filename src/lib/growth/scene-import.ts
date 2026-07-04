/**
 * Cuddler scene → Creative import (pure mapper + tagging). Scenes are the
 * pilot's UGC creative source; imported creatives land review-gated (they must
 * be approved before push, per docs/growth/00-cuddler-first-redesign.md §6) and
 * carry LLM/fallback tags for search + win-rate analysis.
 *
 * Ref: docs/growth/03-creative-studio.md
 */

import { completeJSON, isLLMConfigured } from '@/lib/llm'

export interface SceneInput {
  id: string
  url: string
  prompt?: string | null
  characterTags?: string[] | null
  width?: number | null
  height?: number | null
  durationSec?: number | null
}

export interface CreativeCreateData {
  orgId: string
  userId: string
  name: string
  type: string
  source: string
  fileUrl: string
  sourceRef: string
  prompt: string | null
  width: number | null
  height: number | null
  duration: number | null
  status: string
  reviewStatus: string
  tags: string | null
}

/**
 * Map a scene to a Creative create payload. source=imported_scene,
 * reviewStatus=pending (review-gated). Tags are attached separately.
 */
export function mapSceneToCreative(
  scene: SceneInput,
  ctx: { orgId: string; userId: string },
  tags?: string[],
): CreativeCreateData {
  return {
    orgId: ctx.orgId,
    userId: ctx.userId,
    name: (scene.prompt ?? `Scene ${scene.id}`).slice(0, 80),
    type: 'video',
    source: 'imported_scene',
    fileUrl: scene.url,
    sourceRef: scene.id,
    prompt: scene.prompt ?? null,
    width: scene.width ?? null,
    height: scene.height ?? null,
    duration: scene.durationSec ?? null,
    status: 'ready',
    reviewStatus: 'pending',
    tags: tags && tags.length ? JSON.stringify(tags) : null,
  }
}

const STYLE_HINTS = ['anime', 'realistic', 'fantasy', 'romance', 'cinematic', 'noir', 'cute']
const EMOTION_HINTS = ['happy', 'sad', 'romantic', 'tense', 'playful', 'dramatic', 'cozy']

/** Deterministic tags from the scene's own metadata + prompt keywords. */
export function fallbackTags(scene: SceneInput): string[] {
  const tags = new Set<string>()
  for (const t of scene.characterTags ?? []) if (t) tags.add(t.toLowerCase())
  const text = (scene.prompt ?? '').toLowerCase()
  for (const h of [...STYLE_HINTS, ...EMOTION_HINTS]) if (text.includes(h)) tags.add(h)
  return [...tags].slice(0, 8)
}

/**
 * Tag scenes — LLM batch when configured (character/emotion/style/language),
 * else deterministic fallback. Never throws (falls back). Keyed by scene id.
 */
export async function tagScenes(scenes: SceneInput[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (scenes.length === 0) return out
  if (!isLLMConfigured()) {
    for (const s of scenes) out.set(s.id, fallbackTags(s))
    return out
  }
  try {
    const prompt =
      `Tag these short video scenes for ad-creative search. For each, return up ` +
      `to 6 lowercase tags across character / emotion / style / language. ` +
      `Return JSON {"<id>":["tag",..]}.\n\n` +
      scenes.map((s) => `id=${s.id} "${(s.prompt ?? '').slice(0, 200)}" chars=${(s.characterTags ?? []).join(',')}`).join('\n')
    const parsed = await completeJSON<Record<string, string[]>>(prompt, { maxTokens: 800, temperature: 0.3 })
    for (const s of scenes) {
      const t = parsed[s.id]
      out.set(s.id, Array.isArray(t) && t.length ? t.map((x) => String(x).toLowerCase()).slice(0, 8) : fallbackTags(s))
    }
  } catch {
    for (const s of scenes) out.set(s.id, fallbackTags(s))
  }
  return out
}

/** Parse an inbound scenes payload ({ scenes: [...] } or bare array). */
export function parseScenes(raw: unknown): SceneInput[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { scenes?: unknown })?.scenes) ? (raw as { scenes: unknown[] }).scenes : []
  const out: SceneInput[] = []
  for (const s of arr as Array<Record<string, unknown>>) {
    if (!s || typeof s !== 'object') continue
    const id = typeof s.id === 'string' ? s.id : null
    const url = typeof s.url === 'string' ? s.url : null
    if (!id || !url) continue
    out.push({
      id,
      url,
      prompt: typeof s.prompt === 'string' ? s.prompt : null,
      characterTags: Array.isArray(s.characterTags) ? (s.characterTags as unknown[]).map(String) : null,
      width: typeof s.width === 'number' ? s.width : null,
      height: typeof s.height === 'number' ? s.height : null,
      durationSec: typeof s.durationSec === 'number' ? s.durationSec : null,
    })
  }
  return out
}
