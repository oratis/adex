/**
 * In-process job queue scaffolding.
 *
 * Per docs/agent/05-execution-layer.md and 03-architecture.md §2.2, the long-
 * term plan is Cloud Tasks. As an interim (P12), we run a single-instance
 * process-local queue with simple FIFO + idempotency-key dedupe. Replacing
 * the runtime later means swapping `enqueue()` for an HTTP push to Cloud
 * Tasks; the JobHandler signatures stay the same.
 *
 * This module deliberately does NOT spawn workers on import — call
 * `startWorker()` from a server-only entry (e.g. Next.js instrumentation)
 * once you have a process you control. In serverless deploys, prefer to drive
 * jobs via cron (POST /api/cron/agent) which calls `runJobOnce()`.
 */

export type JobKind = 'sync.account' | 'sync.snapshots' | 'agent.plan' | 'agent.verify'

export type Job<T = Record<string, unknown>> = {
  id: string
  kind: JobKind
  payload: T
  enqueuedAt: number
  idempotencyKey: string
  attempts: number
}

export type JobHandler<T = Record<string, unknown>> = (job: Job<T>) => Promise<void>

const handlers: Map<JobKind, JobHandler> = new Map()
const queue: Job[] = []
const inflight = new Set<string>() // idempotencyKey
const seen = new Map<string, number>() // idempotencyKey -> ts (1-min dedupe window)
const DEDUPE_MS = 60_000

export function registerHandler<T>(kind: JobKind, handler: JobHandler<T>) {
  handlers.set(kind, handler as JobHandler)
}

function dedupe(key: string): boolean {
  const now = Date.now()
  for (const [k, ts] of seen) {
    if (now - ts > DEDUPE_MS) seen.delete(k)
  }
  if (seen.has(key)) return true
  seen.set(key, now)
  return false
}

export function enqueue<T extends Record<string, unknown>>(
  kind: JobKind,
  payload: T,
  idempotencyKey?: string
): Job<T> | null {
  const key = idempotencyKey || `${kind}-${JSON.stringify(payload)}-${Date.now()}`
  if (dedupe(key)) return null
  const job: Job<T> = {
    id: crypto.randomUUID(),
    kind,
    payload,
    enqueuedAt: Date.now(),
    idempotencyKey: key,
    attempts: 0,
  }
  queue.push(job as Job)
  return job
}

/**
 * Drain — execute up to N jobs sequentially. Intended to be called from a
 * cron tick or admin endpoint; the loop is bounded so a stuck handler can't
 * monopolize a serverless invocation.
 */
export async function drain(max = 25): Promise<{ ran: number; failed: number }> {
  let ran = 0
  let failed = 0
  while (queue.length > 0 && ran < max) {
    const job = queue.shift()!
    if (inflight.has(job.idempotencyKey)) continue
    inflight.add(job.idempotencyKey)
    const handler = handlers.get(job.kind)
    if (!handler) {
      console.warn(`[queue] no handler for ${job.kind}`)
      inflight.delete(job.idempotencyKey)
      continue
    }
    try {
      job.attempts++
      await handler(job)
      ran++
    } catch (err) {
      failed++
      console.error(`[queue] job ${job.kind} (${job.id}) failed:`, err)
      // Retry strategy: re-enqueue once with a dedupe-bypassing key.
      if (job.attempts < 2) {
        queue.push({ ...job, idempotencyKey: `${job.idempotencyKey}-retry-${job.attempts}` })
      }
    } finally {
      inflight.delete(job.idempotencyKey)
    }
  }
  return { ran, failed }
}

export function queueDepth(): number {
  return queue.length
}
