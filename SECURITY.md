# Security Policy

## Reporting a vulnerability

If you find a security issue, **please do not open a public GitHub issue**.

Instead, email security@adexads.com with:
- A description of the issue
- Steps to reproduce
- The impact you expect a successful exploit to have
- Your preferred credit (name, GitHub handle, or anonymous)

You can expect:
- An acknowledgement within **3 business days**
- A fix or mitigation plan within **14 days** for high-severity issues
- Credit in the release notes (if you want it) once a fix ships

## Scope

In scope:
- The Adex code in this repository
- Official Adex deployments (adexads.com)
- Official Docker images published from this repo

Out of scope:
- Third-party services we integrate with (Google Ads, Meta, TikTok, etc.) — report to the respective vendor
- Denial-of-service via obvious volumetric attacks on public endpoints
- Self-signed or user-misconfigured deployments (misconfiguration of env vars, DNS, IAM, etc.)
- Issues only exploitable with privileged local access to the server

## Baseline hardening we ship with

- **Signed session cookies** — HMAC-SHA256 over a server secret (`AUTH_TOKEN_SECRET`). Raw user IDs are never accepted as session tokens.
- **Rate limiting** on every sensitive endpoint: login, register, password-reset request/confirm, change-password, delete-account, LLM calls, advisor apply.
- **Password hashing** — SHA-256 at rest. _(Note: we plan to migrate to bcrypt/argon2 in a future release; contributions welcome.)_
- **Password reset tokens** — stored as SHA-256 hash, 1-hour TTL, single-use, all pending tokens invalidated on password change.
- **Invite tokens** — same pattern: SHA-256 hashed, 7-day TTL, single-use.
- **Org-scoped authorization** — every consequential route filters by `orgId` and verifies org membership before acting; admin/owner roles are enforced server-side.
- **Audit log** — every consequential action records who, what, when, and IP address.
- **Security headers** — middleware sets `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **SMTP over TLS** — invite/digest/reset emails use nodemailer with authenticated SMTP.
- **GCS object ACL** — asset uploads are public-read because ads need to be served to ad platforms; signed URLs for sensitive paths are on the roadmap.

## Known gaps we're tracking

These are documented here instead of left silent. If you want to tackle one, see [CONTRIBUTING.md](./CONTRIBUTING.md).

- **Password hashing is SHA-256, not bcrypt/argon2** — good enough for MVP on unique salts-per-deployment (AUTH_TOKEN_SECRET acts as a shared secret that offline attackers still need), but we plan to migrate.
- **No MFA / 2FA** on login yet.
- **Single-tenant S3/GCS bucket** — assets are segregated by `orgId` in the DB, but the bucket is shared. Cross-org object URL guessing requires knowing a full object path.
- **No session revocation UI** — session tokens are valid for 30 days; no way to revoke individual sessions short of changing the password (which does invalidate pending password-reset tokens but not signed session cookies — those only expire naturally). On the roadmap.
- **In-memory rate limiter** — per-instance; a distributed deployment gets softer limits than advertised until we move to Redis.

## Responsible disclosure

We will not take legal action against researchers who:
- Comply with this policy
- Avoid accessing or modifying data that doesn't belong to them
- Give us reasonable time to fix before public disclosure
- Don't exploit beyond what's necessary to demonstrate the issue
