import { readFile } from 'node:fs/promises'
import { describe, it, expect } from 'vitest'
import { orgBucket, renderPrompt } from './loader'

describe('orgBucket', () => {
  it('produces a value in [0, 100)', () => {
    for (const id of ['a', 'org-1', 'cuid_xyz', '🦀']) {
      const b = orgBucket(id, 'agent.plan')
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(100)
    }
  })

  it('is stable for the same (orgId, name)', () => {
    expect(orgBucket('org-1', 'agent.plan')).toBe(orgBucket('org-1', 'agent.plan'))
  })

  it('differs across prompt names for the same org', () => {
    // Pure SHA-256 collisions are vanishingly unlikely; verify ≥ 90% of orgs
    // get a different bucket for two different prompt names.
    let differ = 0
    for (let i = 0; i < 200; i++) {
      const id = `org-${i}`
      if (orgBucket(id, 'agent.plan') !== orgBucket(id, 'advisor.summary')) differ++
    }
    expect(differ).toBeGreaterThan(180)
  })

  it('roughly evenly distributes orgs', () => {
    const buckets: number[] = new Array(10).fill(0)
    for (let i = 0; i < 1000; i++) {
      buckets[Math.floor(orgBucket(`org-${i}`, 'agent.plan') / 10)]++
    }
    for (const c of buckets) {
      // Expect each 10% bucket to land 70..130 of 1000 — generous slack for SHA flatness
      expect(c).toBeGreaterThan(70)
      expect(c).toBeLessThan(130)
    }
  })
})

describe('plan.v1.md template shape', () => {
  // plan.ts splits the template on this marker for prompt caching: everything
  // before it is the stable (cached) half and gets empty vars. Volatile data
  // slots must therefore sit AFTER the marker or they silently render empty.
  it('keeps volatile placeholders after the cache-split marker', async () => {
    const template = await readFile(new URL('./plan.v1.md', import.meta.url), 'utf-8')
    const splitIdx = template.indexOf('## Recent decisions')
    expect(splitIdx).toBeGreaterThan(0)
    for (const slot of ['{{RECENT_DECISIONS_JSON}}', '{{GUARDRAIL_HINTS}}', '{{GROWTH_JSON}}', '{{CAMPAIGNS_JSON}}']) {
      expect(template.indexOf(slot)).toBeGreaterThan(splitIdx)
    }
    expect(template.indexOf('{{TOOL_CATALOG_JSON}}')).toBeLessThan(splitIdx)
  })
})

describe('renderPrompt', () => {
  it('substitutes {{KEY}} placeholders', () => {
    expect(renderPrompt('Hello {{NAME}}!', { NAME: 'world' })).toBe('Hello world!')
  })
  it('replaces all occurrences', () => {
    expect(renderPrompt('{{X}} {{X}} {{X}}', { X: 'y' })).toBe('y y y')
  })
  it('leaves unknown placeholders intact', () => {
    expect(renderPrompt('Hi {{KNOWN}} {{UNKNOWN}}', { KNOWN: 'A' })).toBe('Hi A {{UNKNOWN}}')
  })
})
