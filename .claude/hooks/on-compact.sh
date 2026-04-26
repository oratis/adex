#!/bin/bash
# SessionStart hook (compact matcher): re-inject critical state after compaction

set -euo pipefail

cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 0

echo "=== Context Compaction Recovery (adex) ==="
echo ""

# 1. Recent commits (what was just done)
echo "Recent commits:"
git log --oneline -5 2>/dev/null || true
echo ""

# 2. Uncommitted changes (work in progress)
DIRTY=$(git diff --name-only HEAD 2>/dev/null | head -20)
STAGED=$(git diff --name-only --cached 2>/dev/null | head -20)
if [ -n "$DIRTY" ] || [ -n "$STAGED" ]; then
  echo "Uncommitted changes:"
  [ -n "$STAGED" ] && echo "  Staged: $(echo "$STAGED" | wc -l | tr -d ' ') files"
  [ -n "$DIRTY" ] && echo "  Unstaged: $(echo "$DIRTY" | wc -l | tr -d ' ') files"
  echo ""
fi

# 3. Pending Prisma migration drift
if [ -d prisma/migrations ]; then
  SCHEMA_MTIME=$(stat -f %m prisma/schema.prisma 2>/dev/null || stat -c %Y prisma/schema.prisma 2>/dev/null || echo 0)
  LATEST_MIG_MTIME=$(find prisma/migrations -type f -name 'migration.sql' -exec stat -f %m {} \; 2>/dev/null | sort -nr | head -1)
  if [ -n "$LATEST_MIG_MTIME" ] && [ "$SCHEMA_MTIME" -gt "$LATEST_MIG_MTIME" ]; then
    echo "WARNING: prisma/schema.prisma is newer than the latest migration."
    echo "  Run: npx prisma migrate dev --name <description>"
    echo ""
  fi
fi

# 4. Check for any running dev server on port 3000
RUNNING=$(lsof -ti:3000 2>/dev/null || true)
if [ -n "$RUNNING" ]; then
  echo "WARNING: process found on port 3000. Kill with: lsof -ti:3000 | xargs kill -9"
  echo ""
fi

echo "=== Resume from where you left off ==="
