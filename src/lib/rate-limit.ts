/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Per-instance only — if you run multiple Cloud Run instances each will
 * have its own counter. For a true distributed limiter swap the internal
 * map for Redis / Memorystore. For the open-source baseline this is
 * deliberately simple and dependency-free.
 *
 * Usage inside a route handler:
 *
 *   const rl = checkRateLimit(req, { key: 'login', limit: 5, windowMs: 60_000 })
 *   if (!rl.ok) {
 *     return rateLimitResponse(rl)
 *   }
 *
 * Use `checkRateLimit(req, { ... })` before any DB work so abusive
 * callers are cut off cheaply.
 */
import { NextRequest, NextResponse } from 'next/server'

type Bucket = { count: number; resetAt: number }

// Global across hot-reloads in dev
const globalKey = '__adex_rate_limit_store__'
type GlobalWithStore = typeof globalThis & { [globalKey]?: Map<string, Bucket> }
const store: Map<string, Bucket> =
  (globalThis as GlobalWithStore)[globalKey] ||
  ((globalThis as GlobalWithStore)[globalKey] = new Map<string, Bucket>())

function clientKey(req: NextRequest): string {
  // Cloud Run / proxies forward the real client IP in x-forwarded-for.
  //
  // Audit Low #33 — TRUST ASSUMPTION: this header is client-controllable
  // when the app is reached directly without a trusted proxy in front.
  // We rely on Cloud Run's load balancer to overwrite/append the real IP
  // before the request hits us. If you deploy this behind a different
  // proxy, verify it does the same; otherwise an attacker can spoof IPs
  // here and bypass rate limits.
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp
  return 'unknown'
}

export type RateLimitResult =
  | { ok: true; remaining: number; limit: number; resetAt: number }
  | { ok: false; retryAfterSeconds: number; limit: number; resetAt: number }

export function checkRateLimit(
  req: NextRequest,
  opts: { key: string; limit: number; windowMs: number; identity?: string }
): RateLimitResult {
  const identity = opts.identity || clientKey(req)
  const bucketKey = `${opts.key}:${identity}`
  const now = Date.now()

  // Opportunistic cleanup so the map doesn't grow unbounded
  if (store.size > 10_000) {
    for (const [k, v] of store.entries()) {
      if (v.resetAt < now) store.delete(k)
    }
  }

  const existing = store.get(bucketKey)
  if (!existing || existing.resetAt < now) {
    const fresh: Bucket = { count: 1, resetAt: now + opts.windowMs }
    store.set(bucketKey, fresh)
    return {
      ok: true,
      remaining: opts.limit - 1,
      limit: opts.limit,
      resetAt: fresh.resetAt,
    }
  }

  if (existing.count >= opts.limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      limit: opts.limit,
      resetAt: existing.resetAt,
    }
  }

  existing.count += 1
  return {
    ok: true,
    remaining: opts.limit - existing.count,
    limit: opts.limit,
    resetAt: existing.resetAt,
  }
}

export function rateLimitResponse(result: Extract<RateLimitResult, { ok: false }>): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please slow down.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
      },
    }
  )
}
