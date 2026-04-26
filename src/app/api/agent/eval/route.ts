import { NextResponse } from 'next/server'
import { requireAuthWithOrg } from '@/lib/auth'
import { fixtures } from '@/lib/agent/eval/fixtures'
import { runEval } from '@/lib/agent/eval/runner'
import { isLLMConfigured } from '@/lib/llm'

/**
 * POST /api/agent/eval
 *
 * Run the deployed prompt against all built-in eval fixtures and return the
 * result table. Auth: any org member (read-only LLM call). Owner-only would
 * be safer if costs become a concern.
 */
export async function POST() {
  try {
    await requireAuthWithOrg()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isLLMConfigured()) {
    return NextResponse.json({ error: 'LLM not configured' }, { status: 400 })
  }
  const summary = await runEval(fixtures)
  return NextResponse.json(summary)
}
