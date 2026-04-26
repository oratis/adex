/**
 * Per-rule UI schema for guardrail config. The form generator in
 * /guardrails reads this map to render a typed form per rule, replacing
 * the freeform JSON editor that earlier required users to know exact
 * field names.
 *
 * Each schema is a list of fields. Field types map to HTML inputs:
 *   number  → <input type="number">
 *   integer → <input type="number" step="1">
 *   percent → number with % suffix
 *   string  → <input type="text">
 *   strings → comma-separated text → string[]
 *   hour    → <input type="number" min=0 max=23> (UTC)
 *   localHour → <input type="number" min=0 max=23> (user TZ; converted to UTC on save via lib/time.ts)
 *
 * The `default` value is what the form pre-fills when adding a fresh
 * guardrail of that type.
 */

export type FieldType =
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | { kind: 'integer'; min?: number; max?: number }
  | { kind: 'percent'; min?: number; max?: number }
  | { kind: 'string' }
  | { kind: 'strings' }
  | { kind: 'localHour' }

export type Field = {
  name: string
  label: { en: string; zh: string }
  hint: { en: string; zh: string }
  type: FieldType
  default: unknown
  required?: boolean
}

export type GuardrailSchema = {
  rule: string
  label: { en: string; zh: string }
  description: { en: string; zh: string }
  fields: Field[]
}

export const GUARDRAIL_SCHEMAS: GuardrailSchema[] = [
  {
    rule: 'budget_max_daily',
    label: { en: 'Cap daily budget per campaign', zh: '单条广告系列日预算上限' },
    description: {
      en: 'Reject any adjust_daily_budget step setting daily budget above this amount.',
      zh: '拒绝任何把单条广告系列日预算调高到此金额以上的操作。',
    },
    fields: [
      {
        name: 'max',
        label: { en: 'Max daily budget (USD)', zh: '日预算上限（USD）' },
        hint: { en: 'Hard cap; exceed = rejected.', zh: '硬上限，超过即拒绝。' },
        type: { kind: 'number', min: 1 },
        default: 500,
        required: true,
      },
    ],
  },
  {
    rule: 'budget_max_total_daily',
    label: { en: 'Cap org-wide daily budget total', zh: '组织级日预算总上限' },
    description: {
      en: 'Sum of every active campaign daily budget cannot exceed this number.',
      zh: '所有活跃广告系列日预算之和不超过此值。',
    },
    fields: [
      {
        name: 'max',
        label: { en: 'Max combined daily (USD)', zh: '组织日总上限（USD）' },
        hint: { en: '', zh: '' },
        type: { kind: 'number', min: 1 },
        default: 5000,
        required: true,
      },
    ],
  },
  {
    rule: 'budget_change_pct',
    label: { en: 'Cap budget change percentage', zh: '单次预算变更幅度' },
    description: {
      en: 'Reject single-step budget changes outside this % range.',
      zh: '拒绝单次超过此百分比的预算变更。',
    },
    fields: [
      {
        name: 'maxIncreasePct',
        label: { en: 'Max increase %', zh: '最大上调 %' },
        hint: { en: 'e.g. 50 = up to +50%', zh: '例如 50 = 最多 +50%' },
        type: { kind: 'percent', min: 0, max: 1000 },
        default: 50,
      },
      {
        name: 'maxDecreasePct',
        label: { en: 'Max decrease %', zh: '最大下调 %' },
        hint: { en: 'e.g. 70 = down to -70%', zh: '例如 70 = 最多 -70%' },
        type: { kind: 'percent', min: 0, max: 100 },
        default: 70,
      },
    ],
  },
  {
    rule: 'status_change',
    label: { en: 'Force approval for these tools', zh: '强制审批的工具列表' },
    description: {
      en: 'Any step using one of these tools is routed to /approvals even in autonomous mode.',
      zh: '即使在自治模式下，使用这些工具的步骤也会进入审批队列。',
    },
    fields: [
      {
        name: 'requireApprovalFor',
        label: { en: 'Tool names', zh: '工具名（逗号分隔）' },
        hint: { en: 'comma-separated, e.g. resume_campaign, adjust_bid', zh: '逗号分隔，如 resume_campaign,adjust_bid' },
        type: { kind: 'strings' },
        default: ['resume_campaign'],
      },
    ],
  },
  {
    rule: 'high_risk_requires_approval',
    label: { en: 'Force approval for high-risk tools', zh: '高风险工具强制审批' },
    description: {
      en: 'Any tool with riskLevel=high (adjust_bid / enable_smart_bidding / adjust_targeting_*) requires approval.',
      zh: '所有 riskLevel=high 的工具都需要审批（adjust_bid / enable_smart_bidding / adjust_targeting_*）。',
    },
    fields: [],
  },
  {
    rule: 'agent_active_hours',
    label: { en: 'Restrict agent to active hours', zh: '限定 Agent 工作时间' },
    description: {
      en: 'Agent only acts inside this window. Hours are in YOUR timezone (set on /settings).',
      zh: '只在此时间窗口内允许 Agent 操作。时间按你的本地时区（在 /settings 设置）。',
    },
    fields: [
      {
        name: 'startHourLocal',
        label: { en: 'Start hour (local)', zh: '开始时刻（本地）' },
        hint: { en: '0–23', zh: '0–23' },
        type: { kind: 'localHour' },
        default: 9,
        required: true,
      },
      {
        name: 'endHourLocal',
        label: { en: 'End hour (local, exclusive)', zh: '结束时刻（本地，不含）' },
        hint: { en: '0–23', zh: '0–23' },
        type: { kind: 'localHour' },
        default: 22,
        required: true,
      },
    ],
  },
  {
    rule: 'llm_budget_cap',
    label: { en: 'Stop on LLM monthly budget exhausted', zh: 'LLM 月预算耗尽即停' },
    description: {
      en: 'No new plan() calls when monthlyLlmSpentUsd ≥ monthlyLlmBudgetUsd. Always-on safety.',
      zh: '当月 LLM 花费达到上限时停止 plan() 调用。永久启用。',
    },
    fields: [],
  },
  {
    rule: 'managed_only',
    label: { en: 'Only act on opted-in campaigns', zh: '只对已开管的广告系列操作' },
    description: {
      en: 'Reject any step targeting a campaign with managedByAgent=false.',
      zh: '拒绝任何针对 managedByAgent=false 广告系列的步骤。',
    },
    fields: [],
  },
  {
    rule: 'cooldown',
    label: { en: 'Cooldown between identical steps', zh: '相同步骤的冷却时间' },
    description: {
      en: 'Block exact-duplicate step within N hours; prevents flapping.',
      zh: 'N 小时内拦截一模一样的重复步骤，防止反复横跳。',
    },
    fields: [
      {
        name: 'hours',
        label: { en: 'Hours', zh: '小时数' },
        hint: { en: 'default 4', zh: '默认 4' },
        type: { kind: 'integer', min: 1, max: 168 },
        default: 4,
      },
    ],
  },
  {
    rule: 'pause_only_with_conversions',
    label: { en: 'Require enough data before pausing', zh: '数据不足不允许暂停' },
    description: {
      en: 'Refuse pause when last 24h has too little spend / impressions to draw conclusions.',
      zh: '如果最近 24h 数据不足以判断，拒绝执行暂停。',
    },
    fields: [
      {
        name: 'minSpendThreshold',
        label: { en: 'Min spend (USD)', zh: '最低花费（USD）' },
        hint: { en: 'default 50', zh: '默认 50' },
        type: { kind: 'number', min: 0 },
        default: 50,
      },
      {
        name: 'minImpressionsForSignal',
        label: { en: 'Min impressions', zh: '最低展示数' },
        hint: { en: 'default 2000', zh: '默认 2000' },
        type: { kind: 'integer', min: 0 },
        default: 2000,
      },
    ],
  },
  {
    rule: 'max_per_day',
    label: { en: 'Cap tool executions per day', zh: '每日工具调用次数上限' },
    description: {
      en: 'Each tool can execute at most N times per 24h.',
      zh: '每个工具每 24 小时最多执行 N 次。',
    },
    fields: [
      {
        name: 'max',
        label: { en: 'Max per 24h', zh: '24h 上限' },
        hint: { en: 'default 20', zh: '默认 20' },
        type: { kind: 'integer', min: 1 },
        default: 20,
      },
    ],
  },
  {
    rule: 'requires_approval_above_spend',
    label: { en: 'Force approval for big-money changes', zh: '大额改动强制审批' },
    description: {
      en: 'Force approval when |Δ daily budget| ≥ threshold USD.',
      zh: '当预算改动绝对值 ≥ 阈值 USD 时强制审批。',
    },
    fields: [
      {
        name: 'threshold',
        label: { en: 'Threshold (USD)', zh: '阈值（USD）' },
        hint: { en: 'default 200', zh: '默认 200' },
        type: { kind: 'number', min: 0 },
        default: 200,
      },
    ],
  },
]

export function getSchema(rule: string): GuardrailSchema | undefined {
  return GUARDRAIL_SCHEMAS.find((s) => s.rule === rule)
}
