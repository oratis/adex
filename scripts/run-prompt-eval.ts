/**
 * CLI runner for the agent eval harness — used by the prompt-eval CI gate.
 *
 *   tsx scripts/run-prompt-eval.ts
 *
 * Writes a JSON summary to stdout. Exits 0 regardless of pass rate; the CI
 * step interprets the floor.
 */
import { fixtures } from '../src/lib/agent/eval/fixtures'
import { runEval } from '../src/lib/agent/eval/runner'

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY missing — cannot run eval')
    process.exit(2)
  }
  const summary = await runEval(fixtures)
  // Strip the per-case `decisions` array from stdout to keep the CI log slim;
  // failures still carry the assertion names.
  const slim = {
    ...summary,
    results: summary.results.map((r) => ({
      id: r.id,
      description: r.description,
      passed: r.passed,
      failures: r.failures,
      llmCostUsd: r.llmCostUsd,
      durationMs: r.durationMs,
    })),
  }
  process.stdout.write(JSON.stringify(slim, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
