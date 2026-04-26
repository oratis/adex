---
name: verify
description: Run lint, type-check, build, and Playwright e2e for adex based on what changed. Detects scope from git diff, then delegates to the verify skill.
argument-hint: [fix]
allowed-tools:
  - Read
  - Bash
  - Skill
---

# /verify — Verification Entry Point (adex)

Detect what's changed and delegate execution to the `verify` skill.

## Phase A — Scope Detection

1. Run `git diff --name-only HEAD` to list changed files
2. Map changed paths to verification steps:

| Changed path prefix | Steps |
|---------------------|-------|
| `prisma/schema.prisma` | `npx prisma generate` + check migrations are staged |
| `src/**/*.ts(x)` | `npx eslint <files>` + `npx tsc --noEmit` |
| `src/app/api/**/route.ts(x)` | also: e2e smoke (`npm run test:e2e`) |
| `src/app/(dashboard)/**` | also: e2e smoke |
| `e2e/**/*.spec.ts` | `npm run test:e2e -- <files>` |
| `next.config.ts` / `tsconfig.json` / `package.json` | `npm run build` (full) |
| Docs / `.md` only | nothing to do, exit early |

3. Deduplicate steps. If `$ARGUMENTS` contains `fix` → set auto-fix mode = true (eslint `--fix`, tsc errors → attempt fix, re-run).

### Edge cases
- **No changed files** → report `"No changes detected, nothing to verify"` and exit
- **Only docs/config changes (no TS)** → report `"No code changes — skipping lint/tsc"` and exit

## Phase B — Delegate to Skill

Invoke the `verify` skill via the Skill tool, passing:
- The deduplicated list of steps to run
- `fix` flag (true/false)
- Files to lint (specific paths, not the whole tree)

## Phase C — Report

Relay the skill's output verbatim:
```
✓ eslint: clean
✓ tsc --noEmit: clean
✗ playwright: 1 failed
   - e2e/dashboard.spec.ts > shows trend chart
     Expected text "Spend by platform" to be visible ...
```

If failures exist and `fix` was not set, suggest: `/verify fix` to auto-fix what's safe.

Arguments: $ARGUMENTS
