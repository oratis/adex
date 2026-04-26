#!/bin/bash
# PostToolUse hook: after editing prisma/schema.prisma, remind to regenerate
# and migrate. Non-blocking — just prints next-step guidance.

set -euo pipefail

INPUT=$(cat)

TOOL=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null || echo "")
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; inp=json.load(sys.stdin).get('tool_input',{}); print(inp.get('file_path','') or '')" 2>/dev/null || echo "")

if [[ "$TOOL" != "Edit" && "$TOOL" != "Write" ]]; then
  exit 0
fi

if ! echo "$FILE_PATH" | grep -q "schema.prisma"; then
  exit 0
fi

cat <<'EOF' >&2
[schema.prisma was edited — next steps]
  1. npx prisma generate                                # refresh generated client
  2. npx prisma migrate dev --name <short_description>  # create a migration
  3. git add prisma/schema.prisma prisma/migrations/<new-dir>/
EOF

exit 0
