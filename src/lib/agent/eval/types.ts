/**
 * LLM evaluation harness — types shared by fixtures and runner.
 *
 * Each EvalCase wraps a fully-built PerceiveSnapshot (the same shape produced
 * by perceive()) plus assertions about the resulting plan. Assertions are
 * expressed as predicates over the parsed ProposedDecision[] so a single case
 * can require / forbid specific tools, rationales, severities.
 */
import type { PerceiveSnapshot, ProposedDecision } from '../types'

export type Assertion = {
  name: string
  predicate: (decisions: ProposedDecision[]) => boolean
  // Free-form description for failure messages.
  expected: string
}

export type EvalCase = {
  id: string
  description: string
  snapshot: PerceiveSnapshot
  assertions: Assertion[]
}

export type EvalCaseResult = {
  id: string
  description: string
  passed: boolean
  failures: Array<{ name: string; expected: string }>
  decisions: ProposedDecision[]
  llmCostUsd: number
  durationMs: number
}

export type EvalRunSummary = {
  total: number
  passed: number
  passRate: number
  results: EvalCaseResult[]
  totalCostUsd: number
  totalDurationMs: number
}
