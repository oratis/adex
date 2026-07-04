# Adex Design Language — loopback

> Version v1 · 2026-07-04 · Reference: [loopback pitch](https://loopback-pitch.pages.dev/)
> Adex adopts loopback's **dark, terminal-native** design system and its signature idea: **color encodes agency**.

## Why loopback fits Adex

loopback's defining principle is a two-color system that marks *who acted* — human vs machine. Adex is itself a human + AI-agent platform (an hourly perceive→plan→act loop, a guardrail engine, an approval queue, L0–L4 autonomy). loopback's agency encoding maps onto Adex almost one-to-one, so we don't borrow a skin — we borrow a system that says something true about the product.

## The principle: color = who acted

| | Token | Hex | Meaning in Adex |
|---|---|---|---|
| **Human** | `signal` (lime) | `#a3e635` | approvals, edits, kill-switch, the brand accent, primary buttons |
| **Agent** | `ai` (cyan) | `#56c7f5` | the perceive→plan→act loop — decisions, guardrails, experiments, prompts, agent stats/cost/onboarding |

Where this shows up today:
- **Sidebar** — the wordmark and human/brand nav items are lime; every agent-loop surface renders cyan. You can scan the nav and see which surfaces are "the machine."
- **Status badges** — `executing` (the agent is acting) is cyan; human/outcome states use ok/warn/bad.
- **Buttons** — primary is lime with near-black text (a human action).

Keep it honest: don't paint something cyan unless the agent owns it, or lime unless a human does. The encoding is only useful if it's trustworthy.

## Palette (dark, terminal-native)

Registered in `src/app/globals.css` `@theme` → available as Tailwind utilities (`bg-panel`, `text-signal`, `text-ai`, `border-line`, `text-mut`, …).

| Token | Hex | Use |
|---|---|---|
| `bg` | `#08090b` | app background (near-black) |
| `panel` | `#0b0d11` | cards / panels |
| `surface` | `#0f1116` | inputs, hover surfaces |
| `raised` | `#161a21` | raised chips |
| `line` | `#1c2028` | hairline borders |
| `line2` | `#2a2f3a` | stronger borders / scrollbar thumb |
| `ink` | `#e9ebef` | primary text |
| `mut` | `#8b93a1` | secondary text |
| `dim` | `#5c6472` | tertiary / mono metadata |
| `signal` | `#a3e635` | human / brand |
| `ai` | `#56c7f5` | agent / machine |
| `ok` | `#3fb950` | success / improved |
| `warn` | `#d6a531` | warning / pending |
| `bad` | `#f3635c` | error / regression |
| `max` | `#b18cff` | rollback / premium tier |

Chart ramp: `ai → max → ok → warn → mut` (viz1–5).

## Type & shape

- **Sans** — Inter / system stack (`--font-sans`). **Mono** — `ui-monospace, "SF Mono", Menlo` (`--font-mono`), used for IDs, metrics, money, campaign ids, and state — the engineer-facing numbers.
- **Radii** — tight: `5 / 8 / 11px` (`--radius-lb*`). Cards use 8px, chips 5px. No pill-soft rounding on data chrome.
- **Borders over shadows** — flat surfaces separated by 1px hairlines (`line`), not drop shadows. No gradients, no glow except the `live●` heartbeat.

## Signature elements

- **`live●` status line** — a lime pulse + mono line (`.lb-live` + `font-mono`), e.g. the sidebar footer `agent · 127.0.0.1 :: ready`. The terminal heartbeat; use it where the agent's liveness matters.
- **Before → after framing** — state improvements as `hours → minutes`, `$8 → $4.20`. Metrics in mono.
- **Terminal tone** — plainspoken, declarative. Status reads like a console, not a marketing card.

## How it's wired (don't fight the cascade)

Adex is **dark-first**: `<html>` gets `.dark` by default (see `layout.tsx` init script + `theme-provider`), light mode remains a toggle. Rather than rewrite every component, `globals.css` keeps the pragmatic **utility-inversion** approach and retunes it to the loopback palette — `bg-white→panel`, `text-gray-900→ink`, brand `blue→signal`, borders→`line`. So most pages adopt the language for free; new work should:

1. Reach for tokens (`bg-panel`, `text-mut`, `border-line`) over gray/blue utilities.
2. Use `font-mono` for numbers, ids, and state.
3. Apply the **agency rule** deliberately — lime for human, cyan for agent.

Restyled primitives that cascade: `sidebar`, `ui/button`, `ui/card`, `layout/stat-card`, `ui/status-badge`, `ui/severity-badge`. Per-page polish (mono-ifying tables, adding `live●` to the agent dashboards) is ongoing.
