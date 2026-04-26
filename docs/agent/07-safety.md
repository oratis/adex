# 07 · 安全与人工审批

> Agent 自治的可信度 = guardrails 的可靠程度。本章定义所有"防止 Agent 闯祸"的机制。

## 1. 防御层次

```
LLM 输出 → ① Schema 校验 → ② Guardrail 校验 → ③ 影响估算 →
  ├─ 通过且 < 阈值 → 直接执行
  ├─ 通过但 > 阈值 → 进入审批队列
  └─ 拒绝 → 标记 + 通知 ops
                                       │
执行后 → ④ Outcome 监控 → ⑤ 自动回滚（如适用）
```

## 2. Guardrail 类型与默认值

新 org 默认开启以下 guardrails（用户可调整）：

### 2.1 预算类（最关键）

| 规则 | 默认值 | 行为 |
|---|---|---|
| `org_daily_spend_cap` | 当前 7 天日均 × 1.5 | 当日已花 ≥ cap 时，所有"加预算/启用"动作拒绝 |
| `campaign_daily_budget_cap` | $1000 | 单 campaign 日预算硬上限 |
| `budget_change_pct_per_day` | ±30% | 单 campaign 单日累计调整幅度上限 |
| `budget_change_min_interval` | 24h | 同 campaign 两次调预算最小间隔 |
| `large_change_requires_approval` | spend impact > $200/天 | 进入审批队列 |

### 2.2 状态类

| 规则 | 默认值 | 行为 |
|---|---|---|
| `pause_high_spend_requires_approval` | spend7d > $5000 | 大账号 campaign 暂停需审批 |
| `bulk_action_threshold` | 一次 ≥ 5 个 campaign | 视为 bulk，要求审批 |
| `weekend_freeze` | off | 启用后周末不执行任何 medium/high risk tool |
| `agent_active_hours` | 09:00-21:00 用户时区 | 之外只 shadow，不真执行 |

### 2.3 创意 / 实验类

| 规则 | 默认值 | 行为 |
|---|---|---|
| `experiment_min_sample` | 1000 impressions/arm | conclude_experiment 之前必须达到 |
| `creative_review_required` | true | LLM 生成的文案必须人工 review 才能 push |
| `max_active_experiments` | 3 | per org，防止注意力分散 |

### 2.4 元规则

| 规则 | 默认值 | 行为 |
|---|---|---|
| `min_sync_freshness` | 2h | sync 数据 > 2h 旧时不允许任何 act |
| `consecutive_regression_limit` | 3 | 触发 → 切 shadow 模式 |
| `agent_max_decisions_per_day` | 30 | per org，超出限流 |

## 3. Guardrail 评估器

```ts
// src/lib/agent/guardrails.ts

interface GuardrailReport {
  ok: boolean
  rule: string
  message: string
  blockingMode: 'reject' | 'require_approval' | 'warn'
}

export async function evaluateGuardrails(
  step: { tool: string; input: unknown },
  ctx: PerceiveContext,
  db: PrismaClient
): Promise<GuardrailReport[]> {
  const reports: GuardrailReport[] = []
  const guardrails = await db.guardrail.findMany({ where: { orgId: ctx.org.id, isActive: true } })

  for (const g of guardrails) {
    const evaluator = REGISTRY[g.rule]
    if (!evaluator) continue
    const r = await evaluator(step, ctx, JSON.parse(g.config))
    reports.push(r)
  }
  return reports
}

// 决策：
function decide(reports: GuardrailReport[]): 'execute' | 'require_approval' | 'reject' {
  if (reports.some(r => !r.ok && r.blockingMode === 'reject')) return 'reject'
  if (reports.some(r => !r.ok && r.blockingMode === 'require_approval')) return 'require_approval'
  return 'execute'
}
```

## 4. 审批队列

### 4.1 数据
见 [04-data-model.md](./04-data-model.md) 的 `PendingApproval`。

### 4.2 通知渠道
- **Email**：默认所有 org admin。
- **Slack**：通过 webhook 推到指定 channel（在 settings 配置）。
- **In-app**：dashboard 顶栏徽章 + `/approvals` 页。

### 4.3 审批 UI

```
┌─────────────────────────────────────────────────────────────┐
│ 🚨 Agent proposes: pause "Q4 Brand · Display"               │
│                                                              │
│ Reason: ROAS 0.3× over last 7 days (threshold 0.8×).         │
│         Wasted spend estimated $215.                         │
│                                                              │
│ Impact estimate:                                             │
│   • Saves ~$50/day                                           │
│   • Blocks ~12k impressions/day                              │
│                                                              │
│ Guardrails triggered:                                        │
│   ⚠ pause_high_spend_requires_approval (spend7d=$5,800)      │
│                                                              │
│ Diff:                                                        │
│   status: active → paused                                    │
│                                                              │
│ [Approve] [Reject] [Edit & Approve] [Snooze 24h]             │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 过期策略
- 默认 72h 未处理 → 自动 reject + 通知。
- 高优先级（severity=alert）→ 24h。
- 用户可"snooze"延期。

### 4.5 批量审批
`/approvals?bulk=true` 提供按 severity / platform / 工具类型 筛选 + 批量 approve / reject，避免审批疲劳。

## 5. 自动回滚

### 5.1 触发条件
满足以下**任意**条件，Agent 自动回滚最近一次相关 decision：

- 24h 后 outcome 分类 = `regression` 且 `delta.spend > $100`
- 2h 内连续 3 个相同 tool 失败（如 budget API 反复 reject）
- 平台账号被封禁 / spending halt（来自 webhook）

### 5.2 回滚动作
对每个 reversible tool 定义 `inverse`：

| Tool | Inverse |
|---|---|
| `pause_campaign` | `resume_campaign` |
| `resume_campaign` | `pause_campaign` |
| `adjust_daily_budget` | `adjust_daily_budget(previous_value)` |
| `pause_ad` | `resume_ad` |
| `rotate_creative` | `restore_previous_creative` |

### 5.3 回滚的审计
回滚也是一个 Decision（`triggerType=auto_rollback`），写入完整链路。

## 6. 速率限制（运行时）

| 维度 | 限额 | 实现 |
|---|---|---|
| Per org plan() 调用 | 1/小时 | Postgres advisory lock |
| Per org act() 决策数 | 30/天 | guardrail 计数 |
| Per org Anthropic spend | $X/月（用户配置） | PromptRun 累计 |
| 全局 LLM 并发 | 10 | Memorystore semaphore |
| Per-platform API rate | 各平台官方限制 | adapter 内退避 |

## 7. 数据 / 隐私

### 7.1 LLM 输入脱敏
- 不发用户邮箱、姓名、IP 给 Anthropic。
- Campaign name 保留（业务相关，且非 PII）。
- 平台 ID（customerId 等）保留。
- 当 prompt 含敏感字段时，用 `[redacted-EMAIL]` 占位。

### 7.2 输出存储
- LLM 原文存入 `PromptRun.rawOutput`，仅 org admin 可查看。
- Decision rationale 全员可读（org 内）。

### 7.3 三方共享
- 默认不发任何客户数据给第三方（Anthropic 除外，且签 DPA）。
- Slack webhook 内容只含 decision 摘要，不含 raw data。

## 8. Kill Switch（紧急停机）

每个 org settings 有显眼按钮：

```
🛑 EMERGENCY STOP

This will:
  - Set agent.mode = "off"
  - Cancel all PendingApprovals
  - Pause all running Experiments (preserving control arms)
  - Block all auto sync (manual only)

Use if Agent is misbehaving or you suspect a runaway.
```

激活后：
1. 立即写 `Organization.agentKillSwitch = true`
2. 所有 cron job 进入前置检查 → 跳过该 org
3. 通过 webhook + email 通知所有 admin
4. 写 high-severity AuditEvent

恢复需要 admin 在 UI 确认重新启用。

## 9. 合规挂钩

### 9.1 GDPR / CCPA
- 用户删账号 → 级联删 Decision / DecisionStep / DecisionOutcome（已通过 Cascade）
- 数据导出（GDPR Art. 20）：现有 CSV export 扩展含 decision history

### 9.2 平台政策
- 所有 launch 默认 status=PAUSED，避免 Agent 不慎激活违规创意
- Push creative 前必须人工 review（Phase 15 起）
- 平台返回 policy_violation → 立即 alert + 标记 creative `policyBlocked=true`

## 10. 责任界定（用户协议层面）

文档中明确：

> Adex Agent 在用户配置的 guardrails 内自主操作。用户对：
> - guardrails 的合理性
> - 平台账号的合规状态
> - 最终的支出决策
>
> 负全责。Adex 提供完整审计日志、回滚能力、kill switch，
> 但**不对 Agent 决策的商业结果做担保**。
