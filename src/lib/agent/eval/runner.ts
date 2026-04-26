import { plan } from '../plan'
import type { EvalCase, EvalCaseResult, EvalRunSummary } from './types'

/**
 * runEval — invoke plan() against each fixture, run every assertion, return
 * a structured summary. Caller pays the LLM cost; intended for CI gating
 * (`pass_rate < 0.9` → fail the build).
 *
 * Cases are run sequentially to avoid bursting Anthropic rate limits.
 */
export async function runEval(cases: EvalCase[]): Promise<EvalRunSummary> {
  const results: EvalCaseResult[] = []
  for (const c of cases) {
    const t0 = Date.now()
    let passed = true
    const failures: EvalCaseResult['failures'] = []
    let cost = 0
    let decisions: EvalCaseResult['decisions'] = []
    try {
      const out = await plan(c.snapshot)
      decisions = out.decisions
      cost = out.llm.costUsd
      for (const a of c.assertions) {
        if (!a.predicate(decisions)) {
          passed = false
          failures.push({ name: a.name, expected: a.expected })
        }
      }
    } catch (err) {
      passed = false
      failures.push({
        name: 'plan_threw',
        expected: `plan() should not throw — got ${err instanceof Error ? err.message : String(err)}`,
      })
    }
    results.push({
      id: c.id,
      description: c.description,
      passed,
      failures,
      decisions,
      llmCostUsd: cost,
      durationMs: Date.now() - t0,
    })
  }
  const passedCount = results.filter((r) => r.passed).length
  return {
    total: results.length,
    passed: passedCount,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    results,
    totalCostUsd: results.reduce((s, r) => s + r.llmCostUsd, 0),
    totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
  }
}
