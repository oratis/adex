#!/bin/bash
# PreToolUse hook: gate prisma/schema.prisma edits — require human confirmation
# Detects new/modified/deleted models and dangerous operations
# Exit 0 = allow, Exit 2 = block (needs confirmation)

set -euo pipefail

INPUT=$(cat)

# Extract tool name and file path
TOOL=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null || echo "")
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; inp=json.load(sys.stdin).get('tool_input',{}); print(inp.get('file_path','') or inp.get('command',''))" 2>/dev/null || echo "")

# Only trigger on Edit/Write targeting schema.prisma
if [[ "$TOOL" != "Edit" && "$TOOL" != "Write" ]]; then
  exit 0
fi

if ! echo "$FILE_PATH" | grep -q "schema.prisma"; then
  exit 0
fi

cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 0

SCHEMA="prisma/schema.prisma"
if [ ! -f "$SCHEMA" ]; then
  exit 0
fi

CURRENT_MODELS=$(grep -E "^model " "$SCHEMA" | awk '{print $2}' | sort)

if [ "$TOOL" = "Edit" ]; then
  OLD_STRING=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('old_string',''))" 2>/dev/null || echo "")
  NEW_STRING=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('new_string',''))" 2>/dev/null || echo "")

  NEW_MODELS=$(echo "$NEW_STRING" | grep -E "^model " | awk '{print $2}' || true)
  OLD_MODELS_IN_EDIT=$(echo "$OLD_STRING" | grep -E "^model " | awk '{print $2}' || true)

  # Detect model deletion (model in old_string but not in new_string)
  DELETED_MODELS=""
  for m in $OLD_MODELS_IN_EDIT; do
    if ! echo "$NEW_STRING" | grep -qE "^model $m "; then
      DELETED_MODELS="$DELETED_MODELS $m"
    fi
  done

  # Detect dangerous field operations: removed fields
  REMOVED_FIELDS=$(diff <(echo "$OLD_STRING" | grep -E '^\s+\w+\s+\w+' | sed 's/^[[:space:]]*//' | awk '{print $1}' | sort) \
                        <(echo "$NEW_STRING" | grep -E '^\s+\w+\s+\w+' | sed 's/^[[:space:]]*//' | awk '{print $1}' | sort) \
                   2>/dev/null | grep "^< " | sed 's/^< //' || true)

  if [ -n "$DELETED_MODELS" ]; then
    echo "BLOCKED: Deleting Prisma model(s):$DELETED_MODELS" >&2
    echo "" >&2
    echo "This is a DESTRUCTIVE operation that will drop the table(s) and all data on next migration." >&2
    echo "Please confirm you want to proceed." >&2
    exit 2
  fi

  ACTUALLY_NEW=""
  for m in $NEW_MODELS; do
    if ! echo "$CURRENT_MODELS" | grep -qx "$m"; then
      ACTUALLY_NEW="$ACTUALLY_NEW $m"
    fi
  done

  if [ -n "$ACTUALLY_NEW" ]; then
    echo "CONFIRM: Creating new Prisma model(s):$ACTUALLY_NEW" >&2
    echo "" >&2
    echo "After this edit, you must:" >&2
    echo "  1. Run 'npx prisma generate' to update the generated client" >&2
    echo "  2. Run 'npx prisma migrate dev --name <description>' to create a migration" >&2
    echo "  3. Stage the migration: git add prisma/migrations/<new-dir>/" >&2
    echo "" >&2
    echo "Please confirm to proceed." >&2
    exit 2
  fi

  if [ -n "$REMOVED_FIELDS" ]; then
    echo "CONFIRM: Removing schema field(s): $REMOVED_FIELDS" >&2
    echo "" >&2
    echo "Removing fields drops the column on next migration and may cause data loss." >&2
    echo "Please confirm." >&2
    exit 2
  fi

  if [ -n "$OLD_MODELS_IN_EDIT" ] || [ -n "$NEW_MODELS" ]; then
    echo "CONFIRM: Modifying prisma/schema.prisma" >&2
    echo "" >&2
    echo "Models affected: $(echo "$OLD_MODELS_IN_EDIT $NEW_MODELS" | tr ' ' '\n' | sort -u | tr '\n' ' ')" >&2
    echo "Remember to run prisma generate + create a migration before commit." >&2
    exit 2
  fi

elif [ "$TOOL" = "Write" ]; then
  # Full file rewrite — always block for confirmation
  echo "BLOCKED: Full rewrite of prisma/schema.prisma detected" >&2
  echo "" >&2
  echo "Rewriting the entire schema file is dangerous." >&2
  echo "Please use Edit to make targeted changes instead, or confirm this is intentional." >&2
  exit 2
fi

exit 0
