/**
 * Parse & validate inbound events for POST /api/ingest/events — the backup
 * push channel (GA4 Measurement-Protocol style). Pure so it unit-tests without
 * a request. Unknown event names / sources are dropped, not trusted.
 */

import { EVENTS, SOURCES, isOs, type ConversionEventInput, type EventName, type EventSource, type Os } from './events'
import { resolveChannel, isChannel, type Channel } from './channels'

const EVENT_SET = new Set<string>(Object.values(EVENTS))
const SOURCE_SET = new Set<string>(Object.values(SOURCES))

function str(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 ? x : null
}

/** epoch millis from a number (ms) or ISO string; 0 if unparseable. */
function toMs(x: unknown): number {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string') {
    const n = Number(x)
    if (Number.isFinite(n) && n > 0) return n
    const t = Date.parse(x)
    if (Number.isFinite(t)) return t
  }
  return 0
}

/** Parse one raw event, or null if invalid / not funnel-relevant. */
export function parseIncomingEvent(raw: unknown): ConversionEventInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const eventName = str(r.eventName)
  if (!eventName || !EVENT_SET.has(eventName)) return null

  const source = str(r.source)
  if (!source || !SOURCE_SET.has(source)) return null

  const ms = toMs(r.occurredAt)
  if (!ms) return null

  const utmSource = str(r.utmSource)
  const explicitChannel = str(r.channel)
  const channel: Channel = explicitChannel && isChannel(explicitChannel)
    ? explicitChannel
    : resolveChannel({ utmSource }).channel

  const revenue = typeof r.revenue === 'number' && Number.isFinite(r.revenue) ? r.revenue : 0

  const rawOs = str(r.os)
  const os: Os | null = rawOs && isOs(rawOs) ? rawOs : null

  return {
    source: source as EventSource,
    eventName: eventName as EventName,
    occurredAt: new Date(ms),
    userKey: str(r.userKey),
    utmSource,
    utmCampaign: str(r.utmCampaign),
    channel,
    os,
    country: str(r.country),
    revenue,
    // agency (bi §7): the backend generally doesn't have one to send (Adjust's
    // campaign-name parse is the primary source) — only trusted if explicitly
    // provided, never inferred here.
    agency: str(r.agency),
    raw,
  }
}

/** Parse a batch; silently drops invalid entries. */
export function parseIncomingEvents(raw: unknown): ConversionEventInput[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { events?: unknown })?.events) ? (raw as { events: unknown[] }).events : []
  const out: ConversionEventInput[] = []
  for (const e of arr) {
    const m = parseIncomingEvent(e)
    if (m) out.push(m)
  }
  return out
}
