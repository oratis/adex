import { NextRequest, NextResponse } from 'next/server'

/**
 * Global middleware — attaches a sensible default set of security headers
 * to every response. Intentionally conservative so the app still works
 * with our existing inline theme-init script and with GCS-hosted media.
 */

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Opt out of Google FLoC-style cohort tracking.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  // HSTS — only meaningful over HTTPS; Cloud Run always serves HTTPS at
  // the edge. 1 year + preload-eligible settings.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // Content-Security-Policy tuned for our stack:
  //  - default-src 'self'
  //  - 'unsafe-inline' on script-src because we have the theme-init script
  //    in layout.tsx (dangerouslySetInnerHTML). It's static & self-auditable.
  //  - img-src allows GCS + Google Drive thumbnails + data: URIs
  //  - connect-src allows the Anthropic + ad-platform APIs we call from
  //    the server (doesn't affect server-to-server, but keeps fetch() from
  //    the browser sane if we ever route directly).
  //  - frame-ancestors 'none' mirrors X-Frame-Options DENY
  'Content-Security-Policy': [
    "default-src 'self'",
    // 'unsafe-eval' is needed in dev for React HMR but harmless in prod
    // (we double-toggle below based on NODE_ENV).
    process.env.NODE_ENV === 'production'
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://storage.googleapis.com https://drive.google.com https://lh3.googleusercontent.com",
    "media-src 'self' https://storage.googleapis.com https://ark.cn-beijing.volces.com",
    "font-src 'self' data:",
    "connect-src 'self' https://storage.googleapis.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
}

export function middleware(req: NextRequest) {
  const response = NextResponse.next()
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

export const config = {
  // Skip Next internals and static assets; apply to everything else.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|woff2?|ttf|css|js|map)$).*)',
  ],
}
