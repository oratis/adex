---
name: verify
description: Run lint / tsc / playwright for a given list of files and report results. Invoked by the /verify command after scope detection.
user-invocable: false
allowed-tools:
  - Read
  - Edit
  - Bash
  - Glob
  - Grep
---

# verify — Run adex Verification Steps

> Invoked by the `/verify` command. Scope detection (which files / which steps) has already been done by the command layer.

## Input

- `steps` — list of verification steps to run (lint / tsc / build / e2e / prisma-generate)
- `files` — list of staged or changed files (used to scope eslint)
- `fix` — boolean flag; if true, auto-fix safe issues and re-run once

## Steps

1. **Run sequentially** (avoid parallel — `next build` and `tsc` are memory-heavy):

   - `prisma-generate`: `npx prisma generate`
   - `lint`: `npx eslint <files>` (or `npx eslint --fix <files>` when fix mode)
   - `tsc`: `npx tsc --noEmit`
   - `build`: `npm run build`
   - `e2e`: `npm run test:e2e -- <e2e/files>` (or all if no scope given)

2. **Capture results** per step:
   - Pass / fail
   - Truncated error output (last 25 lines)

3. **Report** using this format:
   ```
   ✓ eslint: clean
   ✓ tsc --noEmit: clean
   ✗ playwright: 1 failed
     - e2e/dashboard.spec.ts > shows trend chart
       Expected text "Spend by platform" to be visible ...
   ```

4. **Fix mode** (if `fix === true`):
   - Re-run eslint with `--fix`
   - For tsc errors, attempt minimal fix (one pass, not a loop)
   - Re-run failed steps once
   - Report final state

## Rules
- Never run `npm run build` and `npm run test:e2e` in parallel — both pull lots of memory
- Never silently ignore a failure — surface it
- `fix` mode is a single pass, not a loop — prevent runaway automation
- Do NOT touch the database in verify; this skill is read-only against the live DB
