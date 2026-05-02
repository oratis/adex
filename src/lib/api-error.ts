import { NextResponse } from 'next/server'

/**
 * Audit Med #23: standardised API error response.
 *
 * Many route handlers were returning raw `error.message` (which can leak
 * stack traces, DB error text, and internal paths) directly to clients.
 * This helper:
 *   1. Logs the full error server-side for diagnostics.
 *   2. Returns a sanitised message to the client by default.
 *   3. Allows callers to override with a friendly user-facing message.
 *
 * Usage:
 *   } catch (err) {
 *     return apiError(err, { route: '/api/foo', status: 500 })
 *   }
 *
 *   // Or with an explicit user-facing message:
 *   return apiError(err, {
 *     route: '/api/foo',
 *     status: 400,
 *     userMessage: 'Failed to update budget — please retry',
 *   })
 */
export function apiError(
  err: unknown,
  opts: {
    /** Route identifier for log grep (e.g. 'POST /api/foo'). */
    route: string
    /** HTTP status to return. Defaults to 500. */
    status?: number
    /** Friendlier message to send to the client. Defaults to a generic one. */
    userMessage?: string
    /** Extra fields to include in the JSON body (e.g. { code: 'rate_limited' }). */
    extra?: Record<string, unknown>
  }
): NextResponse {
  const status = opts.status ?? 500
  const errMsg = err instanceof Error ? err.message : String(err)
  console.error(`[api-error] ${opts.route} (${status}): ${errMsg}`, err)

  // For 4xx, the client error message is usually safe to return verbatim
  // (it's a validation message we authored). For 5xx we hide the detail by
  // default unless caller explicitly opted in.
  const safeMessage =
    opts.userMessage ||
    (status >= 400 && status < 500 ? errMsg : 'Something went wrong — please try again')

  return NextResponse.json({ error: safeMessage, ...opts.extra }, { status })
}

/**
 * Convenience for `apiError` on validation/argument errors. 400 status,
 * passes the error message through (callers usually authored it).
 */
export function badRequest(err: unknown, route: string): NextResponse {
  return apiError(err, { route, status: 400 })
}
