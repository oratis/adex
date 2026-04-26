#!/bin/bash
# PreToolUse hook: quality gate before git commit
# Validates commit message format + runs lint/tsc on staged files
# Exit 0 = allow commit, Exit 2 = block commit

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")

# Only trigger on git commit
if ! echo "$COMMAND" | grep -qE 'git\s+commit'; then
  exit 0
fi

cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 0

# ============================================================
# Commit message format validation
#
# Two accepted formats:
#   1. Conventional: type(scope): summary
#        type:  feat|fix|refactor|perf|style|docs|test|chore|revert
#        scope: app|api|db|ui|auth|platform|advisor|cron|deploy|migration
#        summary: lowercase start, no trailing period, ≤72 chars
#   2. Phase: Phase N: short description (legacy milestone format)
# ============================================================
FIRST_LINE=$(printf '%s' "$COMMAND" | python3 -c '
import sys, re
cmd = sys.stdin.read()
# HEREDOC: first content line after <<EOF / <<"EOF" / <<\x27EOF\x27
h = re.search(r"<<[\x22\x27]?EOF[\x22\x27]?\s*\n(.+?)(?:\n|$)", cmd)
if h:
    print(h.group(1).strip()); sys.exit()
# Inline -m: -m "message" or -m \x27message\x27
i = re.search(r"-m\s+\x22([^\x22]+)\x22|-m\s+\x27([^\x27]+)\x27", cmd)
if i:
    print((i.group(1) or i.group(2)).strip())
' 2>/dev/null || true)

if [ -n "$FIRST_LINE" ]; then
  VALID_TYPES="feat|fix|refactor|perf|style|docs|test|chore|revert"
  VALID_SCOPE="app|api|db|ui|auth|platform|advisor|cron|deploy|migration"
  CONVENTIONAL="^($VALID_TYPES)(\(($VALID_SCOPE)(,($VALID_SCOPE))*\))?: [a-z].{0,71}[^.]\$"
  PHASE="^Phase[[:space:]][0-9]+(\.[0-9]+)?:[[:space:]].+"

  if ! echo "$FIRST_LINE" | grep -qE "$CONVENTIONAL" && ! echo "$FIRST_LINE" | grep -qE "$PHASE"; then
    echo "BLOCKED: Commit message format invalid." >&2
    echo "  Got:      $FIRST_LINE" >&2
    echo "" >&2
    echo "  Accepted formats:" >&2
    echo "    1. type(scope): summary    — conventional commits" >&2
    echo "    2. Phase N: summary        — milestone (legacy)" >&2
    echo "" >&2
    echo "  Types:    $VALID_TYPES" >&2
    echo "  Scopes:   $VALID_SCOPE (optional, comma-separated for multi-area)" >&2
    echo "  Rules:    lowercase start, no trailing period, summary ≤72 chars" >&2
    exit 2
  fi
fi

# Check staged files
STAGED=$(git diff --name-only --cached 2>/dev/null)
if [ -z "$STAGED" ]; then
  exit 0
fi

FAILED=0
RESULTS=""

# --- Prisma schema change: regenerate client + doc/migration sync check ---
if echo "$STAGED" | grep -q "^prisma/schema.prisma"; then
  if command -v timeout >/dev/null 2>&1; then
    output=$(timeout 30 npx prisma generate 2>&1) || gen_failed=1
  else
    output=$(npx prisma generate 2>&1) || gen_failed=1
  fi
  if [ "${gen_failed:-0}" = "1" ]; then
    RESULTS="$RESULTS\n--- Prisma generate FAILED ---\n$(echo "$output" | tail -10)\n"
    FAILED=1
  fi

  # --- Migration evidence: a new migration directory must be staged
  # alongside any schema.prisma change (catches "edited the schema but
  # forgot to run prisma migrate dev").
  if ! echo "$STAGED" | grep -qE "^prisma/migrations/[0-9]+_[^/]+/migration\.sql\$"; then
    RESULTS="$RESULTS\n--- Schema Migration FAILED ---\n"
    RESULTS="$RESULTS  prisma/schema.prisma changed but no new migration is staged.\n"
    RESULTS="$RESULTS  Run: npx prisma migrate dev --name <description>\n"
    RESULTS="$RESULTS  Then: git add prisma/migrations/<new-dir>/migration.sql\n"
    FAILED=1
  fi
fi

# --- Lint changed JS/TS files (quick, non-blocking on warnings) ---
LINT_TARGETS=$(echo "$STAGED" | grep -E "\.(ts|tsx|js|jsx|mjs)\$" | grep -v "^node_modules/" || true)
if [ -n "$LINT_TARGETS" ]; then
  if command -v timeout >/dev/null 2>&1; then
    lint_output=$(timeout 60 npx eslint $LINT_TARGETS 2>&1) || lint_failed=1
  else
    lint_output=$(npx eslint $LINT_TARGETS 2>&1) || lint_failed=1
  fi
  if [ "${lint_failed:-0}" = "1" ]; then
    RESULTS="$RESULTS\n--- ESLint FAILED ---\n$(echo "$lint_output" | tail -25)\n"
    FAILED=1
  fi
fi

# --- Type-check the whole project if any TS file is staged ---
TS_STAGED=$(echo "$STAGED" | grep -E "\.(ts|tsx)\$" | grep -v "^node_modules/" || true)
if [ -n "$TS_STAGED" ]; then
  if command -v timeout >/dev/null 2>&1; then
    tsc_output=$(timeout 120 npx tsc --noEmit 2>&1) || tsc_failed=1
  else
    tsc_output=$(npx tsc --noEmit 2>&1) || tsc_failed=1
  fi
  if [ "${tsc_failed:-0}" = "1" ]; then
    RESULTS="$RESULTS\n--- tsc --noEmit FAILED ---\n$(echo "$tsc_output" | tail -30)\n"
    FAILED=1
  fi
fi

if [ $FAILED -ne 0 ]; then
  echo "BLOCKED: Pre-commit checks failed." >&2
  echo -e "$RESULTS" >&2
  echo "Fix the issues above, then try committing again." >&2
  exit 2
fi

exit 0
