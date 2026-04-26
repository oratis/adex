---
name: implement
description: Structured implementation workflow with pre-flight safety checks. Parses task, verifies git state, then delegates to the implement skill.
argument-hint: <task description>
allowed-tools:
  - Read
  - Bash
  - Skill
  - AskUserQuestion
---

# /implement — Implementation Entry Point (adex)

You are the entry point for structured implementation work on the adex project.
Pre-flight validation lives here; the heavy lifting is in the `implement` skill.

## Phase A — Pre-flight Checks

Run these in parallel:
1. `git status --short` — capture uncommitted changes
2. `git branch --show-current` — capture current branch
3. `git log --oneline -1` — capture HEAD commit

### Decision logic
- **On `main` with dirty tree** → use AskUserQuestion to offer:
  - "Continue on main" (risky, only for tiny fixes)
  - "Stash and continue" (run `git stash push -m "pre-implement"`)
  - "Create a feature branch from current state" (e.g. `feat/<short>`)
  - "Abort, let me handle it"
- **On feature branch with dirty tree** → OK, proceed
- **Clean tree anywhere** → proceed

If user aborts → stop here and report the reason.

## Phase B — Task Echo

Echo the task to the user in one line: `Task: <summary of $ARGUMENTS>` and note the target branch.
Do NOT ask for confirmation — the user already ran the command.

## Phase C — Delegate to Skill

Invoke the `implement` skill via the Skill tool, passing `$ARGUMENTS` as the task description.
The skill handles the Plan → Implement → Test → Verify → Report cycle and spawns `tester` / `reviewer` agents as needed.

## Phase D — Post-flight

After the skill returns:
- Summarise files modified/created (from the skill's report)
- Surface lint / tsc / Playwright results and reviewer verdict
- Remind: commit message must follow either `type(scope): summary` or `Phase N: ...` (enforced by `pre-commit-gate.sh`)
- Remind: if `prisma/schema.prisma` changed, a migration must be created and staged
- Do NOT auto-commit — leave that decision to the user

Task: $ARGUMENTS
