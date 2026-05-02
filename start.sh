#!/bin/sh
set -e

echo "[adex] Starting up..."
echo "[adex] Database: Cloud SQL PostgreSQL"
echo "[adex] Storage: Google Cloud Storage"

# Run Prisma migrations against Cloud SQL (applies any pending migrations)
echo "[adex] Running database migrations..."
# Fail-fast: if migrations don't apply cleanly we MUST NOT start the server
# against an inconsistent schema. Cloud Run will keep the previous revision
# serving traffic while this one fails health checks → safe rollback.
if ! npx prisma migrate deploy 2>&1; then
  echo "[adex] FATAL: prisma migrate deploy failed — refusing to start. Inspect logs and either fix the migration or roll back to the previous revision."
  exit 1
fi

# Start the Next.js server
echo "[adex] Starting server on port ${PORT:-8080}..."
exec node server.js
