import { prisma } from '@/lib/prisma'
import { compareProportions } from '@/lib/agent/experiments/significance'
import type { ToolDefinition } from '../types'
import { requireString } from './_helpers'

type Input = { experimentId: string }

/**
 * conclude_experiment — gather per-arm metrics from Reports, run the z-test,
 * persist the result on Experiment.result, mark status=completed.
 *
 * Mirrors the POST /api/agent/experiments/{id}/conclude logic so the agent
 * can wrap up an experiment unattended once the window has elapsed.
 */
export const concludeExperimentTool: ToolDefinition<Input> = {
  name: 'conclude_experiment',
  description:
    'Conclude a running 2-arm experiment: pull per-arm reports, run z-test on the primary metric (ctr|cvr), persist the result. Marks the experiment as completed even if the result is not significant.',
  inputSchema: {
    type: 'object',
    properties: { experimentId: { type: 'string' } },
    required: ['experimentId'],
  },
  reversible: false,
  riskLevel: 'medium',
  validate(input) {
    return { experimentId: requireString(input, 'experimentId') }
  },
  async execute(ctx, input) {
    const exp = await prisma.experiment.findFirst({
      where: { id: input.experimentId, orgId: ctx.orgId },
      include: { arms: true },
    })
    if (!exp) return { ok: false, error: 'experiment not found' }
    if (exp.status !== 'running') return { ok: false, error: `experiment status is ${exp.status}` }
    if (exp.arms.length !== 2) return { ok: false, error: 'only 2-arm experiments supported' }

    if (ctx.mode === 'shadow') {
      return {
        ok: true,
        output: { skipped: true, would: 'conclude_experiment', experimentId: exp.id },
      }
    }

    const since = exp.startedAt
    const armStats = await Promise.all(
      exp.arms.map(async (arm) => {
        const reports = await prisma.report.findMany({
          where: {
            orgId: ctx.orgId,
            OR: [{ adLinkId: arm.adLinkId }, { adGroupLinkId: arm.adLinkId }],
            date: { gte: since },
          },
        })
        const sum = reports.reduce(
          (a, r) => ({
            impressions: a.impressions + r.impressions,
            clicks: a.clicks + r.clicks,
            conversions: a.conversions + r.conversions,
          }),
          { impressions: 0, clicks: 0, conversions: 0 }
        )
        return { arm, ...sum }
      })
    )

    let result: Record<string, unknown> = { primaryMetric: exp.primaryMetric }
    if (exp.primaryMetric === 'ctr') {
      const cmp = compareProportions(
        { successes: armStats[0].clicks, trials: armStats[0].impressions },
        { successes: armStats[1].clicks, trials: armStats[1].impressions }
      )
      result = {
        ...result,
        ...cmp,
        winner: cmp.significant ? (cmp.z > 0 ? armStats[1].arm.name : armStats[0].arm.name) : null,
      }
    } else if (exp.primaryMetric === 'cvr') {
      const cmp = compareProportions(
        { successes: armStats[0].conversions, trials: armStats[0].clicks },
        { successes: armStats[1].conversions, trials: armStats[1].clicks }
      )
      result = {
        ...result,
        ...cmp,
        winner: cmp.significant ? (cmp.z > 0 ? armStats[1].arm.name : armStats[0].arm.name) : null,
      }
    }

    await prisma.experiment.update({
      where: { id: exp.id },
      data: { status: 'completed', result: JSON.stringify(result) },
    })
    return { ok: true, output: { experimentId: exp.id, result } }
  },
}
