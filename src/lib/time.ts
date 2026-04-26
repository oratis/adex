/**
 * Timezone-aware time helpers.
 *
 * The DB always stores UTC. UI rendering and the `agent_active_hours`
 * guardrail use the user's preferred IANA timezone (User.timezone).
 *
 * Because Adex is single-tenant per user-session, server components pass
 * the user's timezone explicitly into rendered pages; the helper here is
 * pure (no DB / cookie reads) so it works in both server + client contexts.
 */

export function formatInTimezone(
  date: Date | string | number,
  timezone: string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }
): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: timezone }).format(d)
  } catch {
    // Bad timezone string — fall back to UTC
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(d)
  }
}

/**
 * Convert a wall-clock hour in the user's timezone to UTC hour.
 * Used by `agent_active_hours` config form so users enter "9–18 my time"
 * but the guardrail evaluator (which reads UTC via Date.getUTCHours) gets
 * the correct shifted window.
 */
export function localHourToUtc(hour: number, timezone: string): number {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return hour
  // Pick a fixed reference date (today midnight UTC) so DST transitions
  // don't shift the result mid-month — for `active_hours` we treat this as
  // a typical-day approximation, not a per-second exact conversion.
  const ref = new Date()
  ref.setUTCHours(hour, 0, 0, 0)
  // Format in target tz and parse back the hour. Use 12h false to get 0-23.
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    })
    const localHour = parseInt(fmt.format(ref), 10)
    if (!Number.isFinite(localHour)) return hour
    // The user wanted "this is X o'clock locally" — so the UTC value we
    // want to store is the inverse shift.
    const offset = (hour - localHour + 24) % 24
    return (hour + offset) % 24
  } catch {
    return hour
  }
}

/**
 * Inverse: turn a UTC hour into a "this is what you'd see on the clock"
 * hour for the chosen timezone. Used when displaying existing
 * `agent_active_hours` config back to the user.
 */
export function utcHourToLocal(utcHour: number, timezone: string): number {
  if (!Number.isInteger(utcHour) || utcHour < 0 || utcHour > 23) return utcHour
  const ref = new Date()
  ref.setUTCHours(utcHour, 0, 0, 0)
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    })
    return parseInt(fmt.format(ref), 10)
  } catch {
    return utcHour
  }
}

/**
 * Common IANA timezones for the picker. Roughly ordered by relevance to
 * Adex's user base; can be extended freely.
 */
export const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
] as const
