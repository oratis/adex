#!/bin/sh
set -e

echo "[adex] Starting up..."
echo "[adex] Database: Cloud SQL PostgreSQL"
echo "[adex] Storage: Google Cloud Storage"

# Run Prisma migrations against Cloud SQL (applies any pending migrations)
echo "[adex] Running database migrations..."
npx prisma migrate deploy 2>&1 || echo "[adex] WARNING: Migration may have failed — check logs"

# Start the Next.js server
echo "[adex] Starting server on port ${PORT:-8080}..."
exec node server.js
