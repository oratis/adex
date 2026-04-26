---
name: review
description: Independent code review with automatic target resolution. Parses file/PR/diff input, then delegates to the review skill.
argument-hint: [file-path | PR-number | empty]
allowed-tools:
  - Read
  - Bash
  - Skill
---

# /review — Code Review Entry Point (adex)

Resolve what code needs reviewing, then delegate to the `review` skill.

## Phase A — Target Resolution

Parse `$ARGUMENTS`:

| Input | Action |
|-------|--------|
| Existing file path | Target = that file |
| Purely numeric (e.g. `42`) | Run `gh pr diff $ARGUMENTS` → target = PR diff |
| Empty + `git diff HEAD` has output | Target = uncommitted changes |
| Empty + clean tree | Target = `git diff HEAD~1 HEAD` (last commit) |
| Anything else | Ask the user to clarify |

Capture the resolved target as a brief description (e.g. `"uncommitted changes (3 files)"` or `"PR #42 (8 files)"`).

## Phase B — Delegate to Skill

Invoke the `review` skill via the Skill tool, passing the resolved target description and the list of files/diff to review.
The skill spawns the `reviewer` agent for unbiased assessment.

## Phase C — Relay Verdict

Show the user:
- Target that was reviewed
- Reviewer's verdict: `PASS` or `NEEDS_FIX`
- Issues list (if any)
- If `NEEDS_FIX` → offer: "Want me to fix these issues now?"

Target: $ARGUMENTS
