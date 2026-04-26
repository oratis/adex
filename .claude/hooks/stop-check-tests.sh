#!/bin/bash
# Stop hook: warn (not block) when new API routes / lib modules are staged
# without an updated Playwright e2e spec.
#
# adex currently has no unit-test framework — only Playwright e2e at
# e2e/*.spec.ts. We don't gate hard on it; we just remind so coverage
# doesn't silently rot. Exit 0 always.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 0

CHANGED_FILES=$(git diff --name-only --cached 2>/dev/null)
if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

# Look for new (added) route handlers / lib modules
NEW_ROUTES=$(echo "$CHANGED_FILES" | grep -E "^src/app/api/.+/route\.(ts|tsx)\$" || true)
NEW_LIB=$(echo "$CHANGED_FILES" | grep -E "^src/lib/[^/]+\.ts\$" \
            | grep -vE "(prisma|utils|i18n|mailer|storage|webhooks|rate-limit|backup)\.ts\$" \
            || true)

# Did the e2e dir change too?
E2E_TOUCHED=$(echo "$CHANGED_FILES" | grep -E "^e2e/.+\.spec\.ts\$" || true)

if [ -n "$NEW_ROUTES$NEW_LIB" ] && [ -z "$E2E_TOUCHED" ]; then
  echo "" >&2
  echo "[reminder] New business logic staged without an updated e2e spec:" >&2
  [ -n "$NEW_ROUTES" ] && echo "$NEW_ROUTES" | sed 's/^/  - /' >&2
  [ -n "$NEW_LIB" ] && echo "$NEW_LIB" | sed 's/^/  - /' >&2
  echo "" >&2
  echo "  adex currently only has Playwright smoke tests (e2e/*.spec.ts)." >&2
  echo "  Consider adding/extending an e2e spec covering the happy path." >&2
  echo "  This is a soft reminder — commit will not be blocked." >&2
  echo "" >&2
fi

exit 0
