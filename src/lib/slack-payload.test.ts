import { describe, it, expect } from 'vitest'
import { buildSlackPayload } from './slack-payload'

describe('buildSlackPayload', () => {
  it('emits text + blocks for an approval-requested event', () => {
    const p = buildSlackPayload({
      event: 'agent.approval.requested',
      orgId: 'org-1',
      data: { decisionId: 'd-1', severity: 'warning', rationale: 'CTR has dropped' },
      appBaseUrl: 'https://example.com/adex',
    })
    expect(p.text).toContain('warning')
    expect(p.text).toContain('org-1')
    expect(p.blocks.length).toBeGreaterThanOrEqual(2)
    const all = JSON.stringify(p.blocks)
    expect(all).toContain('agent.approval.requested')
    expect(all).toContain('decisionId')
  })

  it('uses info color when severity missing', () => {
    const p = buildSlackPayload({ event: 'campaign.launched', orgId: 'o', data: {} })
    const all = JSON.stringify(p.blocks)
    expect(all.toLowerCase()).toContain('color')
  })

  it('builds an action button only for agent or policy events', () => {
    const agent = buildSlackPayload({
      event: 'agent.decision.executed',
      orgId: 'o',
      data: {},
      appBaseUrl: 'https://x',
    })
    const launch = buildSlackPayload({
      event: 'campaign.launched',
      orgId: 'o',
      data: {},
      appBaseUrl: 'https://x',
    })
    const agentTypes = agent.blocks.map((b) => (b as { type: string }).type)
    const launchTypes = launch.blocks.map((b) => (b as { type: string }).type)
    expect(agentTypes).toContain('actions')
    expect(launchTypes).not.toContain('actions')
  })

  it('truncates long rationale to keep block within Slack limits', () => {
    const huge = 'x'.repeat(2000)
    const p = buildSlackPayload({
      event: 'agent.approval.requested',
      orgId: 'o',
      data: { rationale: huge },
    })
    expect(JSON.stringify(p.blocks).length).toBeLessThan(huge.length + 500)
  })
})
