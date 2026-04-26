---
name: review
description: Spawn reviewer agent for independent code review. Invoked by the /review command after target resolution.
user-invocable: false
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Agent
---

# review — Independent Code Review (adex)

> Invoked by the `/review` command. The target (file path, PR diff, or git diff) has already been resolved by the command layer.

## Steps

1. Receive the resolved review target from the caller (file paths or diff content)
2. Spawn the `reviewer` agent via the Agent tool, passing:
   - A description of what is being reviewed
   - The relevant file paths so reviewer can read them with fresh eyes
3. Capture the reviewer's structured output (Issues / Suggestions / Verdict)
4. Return the full verdict to the caller — do NOT fix issues yourself

## Rules
- Never edit files — you are a read-only orchestrator for the reviewer agent
- Always use the `reviewer` agent (never review inline) so the assessment stays unbiased
- Pass file paths, not file contents — reviewer reads fresh
