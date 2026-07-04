/**
 * Video ad storyboard composition (pure). Builds the hook → scene → end-card
 * structure the pilot's creatives use (docs/growth/01-5k-pilot-plan.md §P4):
 * a 3s hook, the ~5s Cuddler scene body, and a 2–4s end-card with the CTA.
 * When a scene ref is supplied it becomes the scene segment (Cuddler UGC);
 * otherwise the segment carries a generation prompt.
 *
 * Ref: docs/growth/03-creative-studio.md
 */

export type SegmentRole = 'hook' | 'scene' | 'end_card'

export interface StoryboardSegment {
  role: SegmentRole
  startSec: number
  durationSec: number
  prompt?: string // generation prompt (when not sourced from an asset)
  sourceRef?: string // e.g. Cuddler scene id/URL for the scene segment
}

export interface Storyboard {
  segments: StoryboardSegment[]
  totalSec: number
}

export interface StoryboardInput {
  product: string
  hook?: string | null
  cta?: string | null
  sceneRef?: string | null // Cuddler scene → scene segment
  hookSec?: number
  sceneSec?: number
  endCardSec?: number
}

/** Compose a hook + scene + end-card storyboard with cumulative timings. */
export function buildStoryboard(input: StoryboardInput): Storyboard {
  const hookSec = clampSec(input.hookSec ?? 3)
  const sceneSec = clampSec(input.sceneSec ?? 5)
  const endCardSec = clampSec(input.endCardSec ?? 3)

  const segments: StoryboardSegment[] = []
  let t = 0
  const push = (seg: Omit<StoryboardSegment, 'startSec'>) => {
    if (seg.durationSec <= 0) return
    segments.push({ ...seg, startSec: round1(t) })
    t += seg.durationSec
  }

  push({
    role: 'hook',
    durationSec: hookSec,
    prompt: `First ${hookSec}s hook — pattern-interrupt for "${input.product}"${input.hook ? `: ${input.hook}` : ''}. No slow intro; hook in frame 1.`,
  })
  push({
    role: 'scene',
    durationSec: sceneSec,
    sourceRef: input.sceneRef ?? undefined,
    prompt: input.sceneRef ? undefined : `${sceneSec}s scene body for "${input.product}" — the product experience.`,
  })
  push({
    role: 'end_card',
    durationSec: endCardSec,
    prompt: `${endCardSec}s end-card: logo + CTA "${input.cta ?? 'Get the app'}".`,
  })

  return { segments, totalSec: round1(t) }
}

function clampSec(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, 60)
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
