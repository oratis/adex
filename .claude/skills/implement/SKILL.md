---
name: implement
description: Structured implementation execution — Plan → Implement → Verify cycle. Invoked by the /implement command after pre-flight checks.
user-invocable: false
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
---

# implement — Structured Implementation Workflow (adex)

> Invoked by the `/implement` command. Pre-flight git checks have already been performed by the command layer.

You are executing a structured Plan → Implement → Verify cycle.

## Phase 1: Plan
1. Read relevant source files to understand current state
2. Break the task into concrete subtasks (use TodoWrite for each)
3. Identify which files will be created/modified
4. Identify which e2e specs need to be added/extended (if any)
5. Identify whether the change touches `prisma/schema.prisma` — if so, plan the migration step
6. Present the plan briefly and proceed (the user already committed by invoking the command)

## Phase 2: Implement
For each subtask:
1. Mark subtask as `in_progress`
2. Write the implementation code
3. If a route handler / lib module is added, add or extend an e2e spec covering the happy path (same subtask, not separate)
4. If `schema.prisma` was edited:
   - Run `npx prisma generate`
   - Run `npx prisma migrate dev --name <description>` and stage the new migration directory
5. Mark subtask as `completed`

## Phase 3: Verify
After all subtasks complete:
1. Run lint on the touched files: `npx eslint <files>`
2. Run type-check: `npx tsc --noEmit`
3. If e2e was added/changed: `npm run test:e2e -- <spec>`
4. If any check fails → fix before proceeding
5. Spawn the `reviewer` agent for independent code review
6. If reviewer says NEEDS_FIX → address the issues, re-verify
7. Stage files with `git add` (specific files, not `-A`)

## Phase 4: Report
- Summary of changes (files modified/created)
- Lint / tsc / e2e results (X passed, 0 failed)
- Reviewer verdict
- If schema changed: confirm migration was staged

## Rules
- Do NOT skip the migration step when schema changes
- Do NOT commit without lint + tsc passing
- If a subtask takes more than 3 fix attempts, stop and ask the user
- Track progress with TodoWrite so context compaction doesn't lose state
- Do NOT auto-commit — that's the user's call

## Task Naming Convention
Use: `[implement] <subtask description>`

The task to implement is passed in by the `/implement` command caller.
