/**
 * App Store review ingestion + classification. The App Store RSS "customer
 * reviews" feed is PUBLIC JSON (no auth), so fetch works without credentials.
 * Classification ports the Feedback_agent taxonomy (sentiment / topics /
 * priority); it uses the LLM when configured and a deterministic rule-based
 * fallback otherwise — both pure/testable except the network + LLM calls.
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §1.3 (Feedback_agent)
 */

import { completeJSON, isLLMConfigured } from '@/lib/llm'

export interface ReviewRecord {
  id: string // `${source}:${country}:${reviewId}` — idempotent
  source: string // app_store | google_play
  country: string | null
  rating: number | null
  title: string | null
  body: string | null
  reviewedAt: Date
}

export interface ReviewClass {
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
  topics: string[]
  priority: 'P0' | 'P1' | 'P2' | 'P3'
}

/** Topic taxonomy (subset of Feedback_agent's 23 tags, ad/app relevant). */
export const REVIEW_TOPICS = [
  'bug', 'crash', 'performance', 'price', 'subscription', 'refund',
  'content', 'moderation', 'ux', 'feature_request', 'praise', 'account',
] as const

const TOPIC_KEYWORDS: Record<string, string[]> = {
  crash: ['crash', 'crashes', 'freeze', 'froze'],
  bug: ['bug', 'broken', "doesn't work", 'not working', 'glitch', 'error'],
  performance: ['slow', 'lag', 'laggy', 'loading'],
  price: ['expensive', 'overpriced', 'price', 'cost', 'too much'],
  subscription: ['subscription', 'subscribe', 'renew', 'auto-renew', 'cancel'],
  refund: ['refund', 'charged', 'money back', 'scam'],
  content: ['character', 'story', 'chat', 'scene', 'video'],
  moderation: ['nsfw', 'inappropriate', 'ban', 'censored', 'filter'],
  ux: ['confusing', 'ui', 'interface', 'hard to', 'ads'],
  feature_request: ['please add', 'wish', 'would love', 'should have', 'need'],
  praise: ['love', 'amazing', 'best', 'awesome', 'great', 'perfect'],
  account: ['login', 'log in', 'sign in', 'password', 'account'],
}

const P0_KEYWORDS = ['crash', 'refund', 'charged', 'scam', 'lost my', 'stolen', 'lawsuit']

/** Parse the App Store RSS "customerreviews" JSON feed into review records. */
export function parseAppStoreReviews(
  json: unknown,
  opts: { source?: string; country: string },
): ReviewRecord[] {
  const feed = (json as { feed?: { entry?: unknown } })?.feed
  const rawEntries = feed?.entry
  const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : []
  const source = opts.source ?? 'app_store'
  const out: ReviewRecord[] = []

  for (const e of entries as Array<Record<string, unknown>>) {
    // Review entries carry im:rating; the leading app-info entry does not.
    const ratingLabel = label(e['im:rating'])
    if (ratingLabel === null) continue
    const reviewId = label(e.id)
    if (!reviewId) continue
    const updated = label(e.updated)
    out.push({
      id: `${source}:${opts.country}:${reviewId}`,
      source,
      country: opts.country,
      rating: ratingLabel !== null ? Number(ratingLabel) : null,
      title: label(e.title),
      body: label(e.content),
      reviewedAt: updated ? new Date(updated) : new Date(0),
    })
  }
  return out
}

function label(v: unknown): string | null {
  if (typeof v === 'string') return v
  const l = (v as { label?: unknown })?.label
  return typeof l === 'string' ? l : null
}

/** Deterministic classification — the fallback when no LLM is configured. */
export function fallbackClassify(r: Pick<ReviewRecord, 'rating' | 'title' | 'body'>): ReviewClass {
  const text = `${r.title ?? ''} ${r.body ?? ''}`.toLowerCase()
  const rating = r.rating ?? 3

  const topics = Object.entries(TOPIC_KEYWORDS)
    .filter(([, kws]) => kws.some((k) => text.includes(k)))
    .map(([t]) => t)

  const sentiment: ReviewClass['sentiment'] =
    rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative'

  const hasP0 = P0_KEYWORDS.some((k) => text.includes(k))
  const priority: ReviewClass['priority'] =
    rating <= 2 && hasP0 ? 'P0' : rating <= 2 ? 'P1' : rating === 3 ? 'P2' : 'P3'

  return { sentiment, topics, priority }
}

/**
 * Classify reviews — LLM batch when configured, else rule-based fallback.
 * Returns a map keyed by review id. Never throws on LLM failure (falls back).
 */
export async function classifyReviews(reviews: ReviewRecord[]): Promise<Map<string, ReviewClass>> {
  const out = new Map<string, ReviewClass>()
  if (reviews.length === 0) return out

  if (!isLLMConfigured()) {
    for (const r of reviews) out.set(r.id, fallbackClassify(r))
    return out
  }

  try {
    const prompt =
      `Classify these app store reviews. For each, return sentiment ` +
      `(positive|neutral|negative|mixed), up to 3 topics from ` +
      `[${REVIEW_TOPICS.join(', ')}], and priority (P0 urgent crash/refund/legal, ` +
      `P1 serious, P2 minor, P3 praise/noise).\n\n` +
      `Return a JSON object keyed by review id: {"<id>":{"sentiment":..,"topics":[..],"priority":..}}\n\n` +
      reviews.map((r) => `id=${r.id} rating=${r.rating} "${(r.title ?? '').slice(0, 80)}: ${(r.body ?? '').slice(0, 300)}"`).join('\n')

    const parsed = await completeJSON<Record<string, ReviewClass>>(prompt, { maxTokens: 1500, temperature: 0.2 })
    for (const r of reviews) {
      const c = parsed[r.id]
      out.set(r.id, c && c.sentiment ? c : fallbackClassify(r))
    }
  } catch {
    for (const r of reviews) out.set(r.id, fallbackClassify(r))
  }
  return out
}

/** Fetch the public App Store customer-reviews RSS (JSON) for one country. */
export async function fetchAppStoreReviews(storeId: string, country: string): Promise<ReviewRecord[]> {
  const url = `https://itunes.apple.com/${country}/rss/customerreviews/id=${storeId}/sortBy=mostRecent/json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`App Store RSS ${res.status} for ${country}`)
  return parseAppStoreReviews(await res.json(), { source: 'app_store', country })
}
