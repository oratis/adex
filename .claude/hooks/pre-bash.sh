#!/bin/bash
# PreToolUse hook for Bash commands
# Blocks dangerous operations, auto-cleans dev server port (3000)
# Exit 0 = allow, Exit 2 = block (stderr returned to Claude)

set -euo pipefail

# Read JSON from stdin
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")

# Fail open on parse errors
if [ -z "$COMMAND" ]; then
  exit 0
fi

# --- BLOCK: git push --force ---
if echo "$COMMAND" | grep -qE 'git\s+push\s+.*(-f|--force)\b'; then
  echo "BLOCKED: git push --force is not allowed. Use regular git push." >&2
  exit 2
fi

# --- BLOCK: destructive rm -rf on broad paths ---
if echo "$COMMAND" | grep -qE 'rm\s+-rf\s+(/|\.\.|\*|src/|prisma/|node_modules)'; then
  echo "BLOCKED: rm -rf on broad paths is not allowed. Be specific." >&2
  exit 2
fi

# --- BLOCK: docker-compose for local Postgres (no local DB rule) ---
# Only blocks when the compose target appears to be a database. Plain
# docker-compose for non-DB services is fine.
if echo "$COMMAND" | grep -qE 'docker[-\s]compose\s+up.*(postgres|pg|db)|docker\s+compose\s+up.*(postgres|pg|db)'; then
  echo "BLOCKED: No local Postgres. Use Cloud SQL via DATABASE_URL, or sqlite dev.db for offline iteration." >&2
  exit 2
fi

# --- BLOCK: prisma migrate reset on production-looking DSN ---
if echo "$COMMAND" | grep -qE 'prisma\s+migrate\s+reset' && echo "$COMMAND" | grep -qiE 'cloudsql|amazonaws|prod|production'; then
  echo "BLOCKED: prisma migrate reset against a production-looking DATABASE_URL." >&2
  echo "If this is intentional, run the command manually outside Claude." >&2
  exit 2
fi

# --- AUTO: kill zombie process on port 3000 before next dev ---
# Be careful: matching plain literals like "next dev" in *check* commands
# would also trigger the cleanup. We only auto-kill when the command looks
# like a real start (npm run dev / next dev / npx next dev), not a probe.
if echo "$COMMAND" | grep -qE '(^|[[:space:]&;|])(npm|pnpm|yarn|npx)[[:space:]]+(run[[:space:]]+)?dev([[:space:]]|$)' \
   || echo "$COMMAND" | grep -qE '(^|[[:space:]&;|])next[[:space:]]+dev([[:space:]]|$)'; then
  lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
fi

exit 0
