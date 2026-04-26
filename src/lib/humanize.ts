/**
 * Convert technical labels (audit actions, decision tools, status enums) to
 * plain English / Chinese phrases. Centralised so docs/UX never drift.
 *
 * Returns a tuple of {en, zh} so callers can pick by locale without doing
 * lookups twice. If you add a new label, add both translations.
 */

export type Bilingual = { en: string; zh: string }

const TOOL_NAMES: Record<string, Bilingual> = {
  pause_campaign:           { en: 'Pause campaign',                    zh: '暂停广告系列' },
  resume_campaign:          { en: 'Resume campaign',                   zh: '恢复广告系列' },
  adjust_daily_budget:      { en: 'Adjust daily budget',               zh: '调整日预算' },
  pause_ad_group:           { en: 'Pause ad group',                    zh: '暂停广告组' },
  pause_ad:                 { en: 'Pause ad',                          zh: '暂停广告' },
  rotate_creative:          { en: 'Rotate creative',                   zh: '更换创意' },
  flag_for_review:          { en: 'Flag for human review',             zh: '提交人工审核' },
  noop:                     { en: 'Take no action',                    zh: '不做任何操作' },
  clone_campaign:           { en: 'Clone campaign',                    zh: '复制广告系列' },
  start_experiment:         { en: 'Start A/B experiment',              zh: '开启 A/B 实验' },
  conclude_experiment:      { en: 'Conclude experiment',               zh: '结束实验' },
  generate_creative_variant:{ en: 'Generate creative variant',         zh: '生成创意变体' },
  push_creative_to_platform:{ en: 'Push creative to platform',         zh: '推送创意到平台' },
  adjust_bid:               { en: 'Adjust max bid',                    zh: '调整最高出价' },
  enable_smart_bidding:     { en: 'Switch to smart bidding',           zh: '切换智能出价' },
  adjust_targeting_geo:     { en: 'Change geo targeting',              zh: '调整地域定向' },
  adjust_targeting_demo:    { en: 'Change demographic targeting',      zh: '调整人群定向' },
}

export function toolLabel(name: string): Bilingual {
  return TOOL_NAMES[name] ?? { en: name, zh: name }
}

const STATUS_LABELS: Record<string, Bilingual> = {
  // Decision status
  pending:        { en: 'Awaiting approval', zh: '等待审批' },
  approved:       { en: 'Approved',          zh: '已批准' },
  rejected:       { en: 'Rejected',          zh: '已拒绝' },
  executing:      { en: 'Running',           zh: '执行中' },
  executed:       { en: 'Done',              zh: '已完成' },
  failed:         { en: 'Failed',            zh: '失败' },
  rolled_back:    { en: 'Rolled back',       zh: '已回滚' },
  skipped:        { en: 'Shadow only',       zh: '仅观察' },
  // Outcome
  success:        { en: 'Worked',            zh: '有效' },
  neutral:        { en: 'Neutral',           zh: '中性' },
  regression:     { en: 'Backfired',         zh: '反效果' },
  false_positive: { en: 'False alarm',       zh: '误报' },
}

export function statusLabel(s: string | null | undefined): Bilingual {
  if (!s) return { en: '—', zh: '—' }
  return STATUS_LABELS[s] ?? { en: s, zh: s }
}

const SEVERITY_LABELS: Record<string, Bilingual> = {
  info:        { en: 'Info',          zh: '信息' },
  opportunity: { en: 'Opportunity',   zh: '机会' },
  warning:     { en: 'Warning',       zh: '警告' },
  alert:       { en: 'Alert',         zh: '紧急' },
}

export function severityLabel(s: string): Bilingual {
  return SEVERITY_LABELS[s] ?? { en: s, zh: s }
}

const AUDIT_ACTION_LABELS: Record<string, Bilingual> = {
  'campaign.create':       { en: 'created campaign',          zh: '创建了广告系列' },
  'campaign.update':       { en: 'updated campaign',          zh: '更新了广告系列' },
  'campaign.delete':       { en: 'deleted campaign',          zh: '删除了广告系列' },
  'campaign.launch':       { en: 'launched campaign',         zh: '启动了广告系列' },
  'campaign.pause':        { en: 'paused campaign',           zh: '暂停了广告系列' },
  'campaign.resume':       { en: 'resumed campaign',          zh: '恢复了广告系列' },
  'creative.create':       { en: 'created creative',          zh: '创建了创意' },
  'creative.delete':       { en: 'deleted creative',          zh: '删除了创意' },
  'creative.attach':       { en: 'attached creative',         zh: '关联了创意' },
  'budget.create':         { en: 'created budget',            zh: '创建了预算' },
  'budget.update':         { en: 'updated budget',            zh: '修改了预算' },
  'budget.delete':         { en: 'deleted budget',            zh: '删除了预算' },
  'platform.connect':      { en: 'connected platform',        zh: '接入了平台' },
  'platform.disconnect':   { en: 'disconnected platform',     zh: '断开了平台' },
  'member.invite':         { en: 'invited a member',          zh: '邀请了成员' },
  'member.invite_revoke':  { en: 'revoked an invite',         zh: '撤销了邀请' },
  'member.invite_accept':  { en: 'accepted invite',           zh: '接受了邀请' },
  'member.role_change':    { en: 'changed a role',            zh: '修改了角色' },
  'member.remove':         { en: 'removed a member',          zh: '移除了成员' },
  'org.create':            { en: 'created workspace',         zh: '创建了工作区' },
  'org.switch':            { en: 'switched workspace',        zh: '切换了工作区' },
  'advisor.apply':         { en: 'applied an action',         zh: '执行了一项操作' },
  'cron.daily':            { en: 'ran daily cron',            zh: '执行了每日同步' },
}

export function actionLabel(action: string): Bilingual {
  return AUDIT_ACTION_LABELS[action] ?? { en: action, zh: action }
}

const TARGET_LABELS: Record<string, Bilingual> = {
  campaign:       { en: 'campaign',          zh: '广告系列' },
  ad:             { en: 'ad',                zh: '广告' },
  ad_group:       { en: 'ad group',          zh: '广告组' },
  creative:       { en: 'creative',          zh: '创意' },
  decision:       { en: 'decision',          zh: '决策' },
  agent_config:   { en: 'agent settings',    zh: 'Agent 设置' },
  guardrail:      { en: 'guardrail',         zh: '安全规则' },
  approval_bulk:  { en: 'bulk approvals',    zh: '批量审批' },
  campaign_bulk:  { en: 'bulk campaigns',    zh: '批量广告系列' },
  invite_code:    { en: 'invite code',       zh: '邀请码' },
  user:           { en: 'user',              zh: '用户' },
}

export function targetLabel(t: string): Bilingual {
  return TARGET_LABELS[t] ?? { en: t, zh: t }
}

/**
 * Render a single audit event as a sentence:
 *   "Wang Hap deleted campaign Foo at 14:32" / "王某 删除了广告系列 Foo 14:32"
 */
export function describeAuditEvent(opts: {
  action: string
  userName?: string | null
  targetType?: string | null
  targetSummary?: string | null
}): Bilingual {
  const who = opts.userName || (opts.userName === null ? 'System' : 'Someone')
  const a = actionLabel(opts.action)
  const t = opts.targetType ? targetLabel(opts.targetType) : null
  const target = opts.targetSummary || (t ? `(${t.en})` : '')
  const targetZh = opts.targetSummary || (t ? `(${t.zh})` : '')
  return {
    en: `${who} ${a.en}${target ? ' ' + target : ''}`,
    zh: `${who === 'System' ? '系统' : who} ${a.zh}${targetZh ? ' ' + targetZh : ''}`,
  }
}

/**
 * Build a one-paragraph plain-English summary of a Decision suitable for
 * the top of /decisions/{id}.
 */
export function describeDecision(opts: {
  rationale: string
  severity: string
  status: string
  toolNames: string[]
  outcome?: string | null
}): Bilingual {
  const sev = severityLabel(opts.severity)
  const status = statusLabel(opts.status)
  const tools = opts.toolNames.map((n) => toolLabel(n))
  const toolsEn = tools.map((t) => t.en.toLowerCase()).join(', ')
  const toolsZh = tools.map((t) => t.zh).join('、')
  const outcomeEn = opts.outcome ? `, outcome: ${statusLabel(opts.outcome).en}` : ''
  const outcomeZh = opts.outcome ? `，结果：${statusLabel(opts.outcome).zh}` : ''
  return {
    en: `${sev.en} · ${status.en} · ${toolsEn || 'no steps'}${outcomeEn}. ${opts.rationale}`,
    zh: `${sev.zh} · ${status.zh} · ${toolsZh || '无步骤'}${outcomeZh}。${opts.rationale}`,
  }
}
