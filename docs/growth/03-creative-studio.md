# Creative Studio — the material (物料) capability (P20)

> Version v1 · 2026-07-04 · Part of [00-cuddler-first-redesign.md](00-cuddler-first-redesign.md) §6

Turns a **brief** into a **DCO variant matrix** of platform-fitted ad material, and imports Cuddler **scenes** as review-gated creatives. Grounded in the IAB Dynamic Content Ads model (a base creative with swappable slots) and the open-source creative-automation pattern (brief → multi-format localized assets).

## The pipeline

```
Brief (product, audience, angle, platforms, hooks, languages)
   │  buildVariantMatrix  → platform × format × hook × language  (deduped, capped)
   ▼
Variant matrix
   │  generateCopy(spec.text)  → headline/primary/CTA fitted to each platform's char limits
   │  validateCreative(asset, spec)  → conforms | needs_resize | needs_transcode | rejected
   ▼
CreativeVariant rows  ──►  produce asset (Seedream/Seedance2 or imported scene)  ──►  review → push
```

## Modules (`src/lib/growth/`, all pure + unit-tested)

| Module | Role |
|---|---|
| `creative-specs.ts` | Per-platform/placement spec registry (TikTok in-feed, Meta Reels/Feed, Google App, Apple Search Ads) grounded in 2025–26 guidance. `validateCreative` → conformance, distinguishing **resize** (dims/ratio) vs **transcode** (duration/size/container) vs **rejected**. ASA = uses the App Store product page (no upload). |
| `creative-copy.ts` | `generateCopy` (LLM asked to respect char limits, deterministic fallback) + `fitText`/`fitCopy`/`validateCopy` so output **never exceeds** platform maximums. |
| `creative-brief.ts` | `buildVariantMatrix` — the DCO fan-out, deduped and capped (truncation reported, never silent). |
| `storyboard.ts` | `buildStoryboard` — hook (3s) → scene (5s) → end-card (2–4s) with cumulative timings; a Cuddler scene ref becomes the scene segment. |
| `scene-import.ts` | `parseScenes` + `mapSceneToCreative` (source=imported_scene, **reviewStatus=pending**) + `tagScenes` (LLM character/emotion/style/language, fallback). |

## Data model

- `Creative.sourceRef` / `tags` — scene provenance + creative tags
- `CreativeBrief` — the production brief
- `CreativeVariant` — one matrix cell: platform/format/hook/language + fitted copy + produced `creativeId` + `specStatus`

## Surfaces

- `POST /api/creatives/studio` — create brief → fan out matrix → generate fitted copy per variant
- `GET /api/creatives/studio[?briefId=]` — list briefs / one brief's variants
- `POST /api/ingest/scenes?org=` — HMAC-authed scene import (idempotent by `sourceRef`)
- `/creatives/studio` — brief form → variant matrix with spec-status lights

## Guardrails / gates

- **Review-gated**: imported scenes land `reviewStatus=pending`; nothing pushes to a platform before the existing `creatives/review` approval (the IP/authorization gate — Cuddler has known third-party-IP scene risk).
- **Spec-safe**: a variant can't ship until `validateCreative` returns `conforms`; `needs_transcode`/`needs_resize` are surfaced, not silently pushed.
- **Bounded**: the matrix caps at `DEFAULT_MAX_VARIANTS` (40) with truncation reported.

## What's left (needs external services)

Actual asset rendering (wiring variants → Seedream/Seedance2 jobs), video transcode/crop for `needs_transcode`/`needs_resize`, and the platform push of produced creatives are the integration steps that need those services' credentials. The decision + fitting + validation layer here is complete and tested.
