# 06 · Agent 决策循环 + Tool Catalog

## 1. 主循环

```
┌─────────────────────────────────────────────────────────────────┐
│                          AGENT LOOP                              │
│                                                                  │
│   每 60 分钟（每 org，并发隔离）                                  │
│                                                                  │
│   ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌─────────┐│
│   │ Perceive  │───▶│   Plan    │───▶│    Act    │───▶│  Verify ││
│   │ (gather)  │    │   (LLM)   │    │  (tools)  │    │  (24h+) ││
│   └───────────┘    └───────────┘    └───────────┘    └─────────┘│
│        │                │                │                │      │
│        ▼                ▼                ▼                ▼      │
│   仅 DB 读        Anthropic API   PlatformAdapter   异步 cron    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Perceive（感知）

```ts
// src/lib/agent/perceive.ts

interface PerceiveContext {
  org: { id: string; name: string; baseCurrency: string }
  guardrails: GuardrailSummary[]
  campaigns: CampaignContext[]      // 仅 managedByAgent=true 的
  recentDecisions: DecisionDigest[] // 过去 7 天
  outcomes: OutcomeSummary[]        // 过去 7 天有 outcome 的 decision
  budgetStatus: { totalDailyCap?: number; spentToday: number; remainingToday: number }
}

interface CampaignContext {
  id: string
  platform: PlatformName
  name: string
  objective: string
  status: 'active' | 'paused'
  managedByAgent: boolean
  budget: { type: 'daily' | 'lifetime'; amount: number; currency: string }
  // 关键：多窗口指标
  metrics: {
    last24h: Metrics
    last7d: Metrics
    prev7d: Metrics              // 用于趋势对比
  }
  // 当前活跃实验（如有）
  activeExperiment?: { id: string; arms: { name: string; metrics: Metrics }[] }
}
```

**调用入口**：`gatherPerceiveContext(orgId): Promise<PerceiveContext>`

**关键约束**：
- 只读 DB，不调任何外部 API（保证 perceive 阶段几秒内完成）。
- 如果 sync 已超过 2 小时未跑，强制等 sync 完成再 plan（避免基于陈旧数据决策）。

## 3. Plan（决策）

### 3.1 Prompt 模板（v1）

```
You are Adex Agent, an autonomous paid-ads optimizer.
Your mandate: improve ROAS while staying within the org's guardrails.

# CONTEXT
Organization: {{orgName}} (currency: {{currency}})

## Active guardrails
{{guardrails as bullets}}

## Recent decisions (last 7 days, with outcomes)
{{recentDecisions: action, target, outcome (success/regression/pending)}}

## Campaign performance ({{campaignCount}} managed campaigns)
{{campaigns: name | platform | status | spend7d | revenue7d | roas7d | roas_trend}}

## Budget status today
Total cap: ${{totalDailyCap}}
Spent: ${{spentToday}}
Remaining: ${{remainingToday}}

# TOOLS AVAILABLE
{{tool catalog as JSON schema}}

# YOUR TASK
Decide what (if any) actions to take right now. Output JSON:
{
  "decisions": [
    {
      "rationale": "1-3 sentences citing specific numbers from CONTEXT",
      "severity": "info | opportunity | warning | alert",
      "steps": [
        { "tool": "<tool_name>", "input": { ... } }
      ]
    }
  ]
}

# RULES
- Cite specific numbers in rationale. Vague rationales are rejected.
- Prefer multiple small adjustments over one large one.
- If a campaign was just adjusted in last 24h, do NOT touch it again unless metrics worsened materially.
- If you're unsure, return empty decisions array — inaction is safe.
- NEVER suggest creating new campaigns or changing accounts. Those need human input.
```

### 3.2 LLM 配置
- 模型：`claude-sonnet-4-5`（默认）/ `claude-opus-4-5`（高价值客户可选）
- 模式：使用 Anthropic Tool Use API（结构化 tool_call 比 JSON parsing 更可靠）
- `max_tokens`: 4000
- `temperature`: 0.2（决策要稳定）
- **Prompt caching**：把 guardrails / tool catalog 标记为 `cache_control` 复用，每次仅 campaign 数据变化

### 3.3 Plan 输出校验
```ts
function validatePlan(raw: unknown): { ok: true; plan: ParsedPlan } | { ok: false; errors: string[] }
```
- 每个 step 的 tool 必须存在于 catalog
- 每个 input 必须通过该 tool 的 zod schema
- decisions 数 > 10 视为异常，截断并报警
- 同一 campaign 的不同 decision 合并

## 4. Act（执行）

### 4.1 Pipeline

```
For each Decision:
  1. 写 Decision row (status=pending)
  2. For each Step:
     a. Guardrail check → 通过 / 拒 / 需审批
     b. 如需审批: 创建 PendingApproval, 通知, status=pending → 跳出
     c. 执行: PlatformAdapter.<tool>(input)
        - 失败 → 写 DecisionStep.status=failed, 整个 Decision 标记 failed
        - 成功 → 写 DecisionStep.status=executed
     d. 更新本地相关表（Campaign.desiredStatus 等）
  3. 全部成功 → Decision.status=executed, 设置 outcome_at = now + 24h
  4. fire webhook
  5. 写 AuditEvent
```

### 4.2 并发与隔离
- 同一 org 同时只跑一个 plan-act 周期（Postgres advisory lock on `decision_loop_${orgId}`）。
- 不同 org 并发不限。

## 5. Verify（回看）

每天另起 cron（每天 4am UTC）：

```ts
// 1. 找出过去 30 天 outcome IS NULL AND outcome_at < now 的 decision
// 2. 对每个 decision:
//    - 抓影响实体（campaignLinkId 等）的 metrics:
//        before = 决策前 N 天均值（N = decision 发生时距上次 outcome 的天数，cap 7）
//        after  = 决策后 24h 均值（或 7d，看 windowHours）
//    - 计算 delta: spend, revenue, roas, ctr, conversions
//    - 分类:
//        success      = primary_metric_delta > +5%
//        neutral      = -5% < delta < +5%
//        regression   = delta < -5% AND p < 0.1（简单 z-test）
//        false_positive = decision 是 pause 但 7d 后该 campaign 在其他平台/账号被人工恢复且表现良好
//    - 写 DecisionOutcome
//    - 如果连续 3 个 regression：触发 "agent quality alert" 进入降级模式
```

## 6. Tool Catalog

### 6.1 Tool 接口

```ts
// src/lib/agent/tools/types.ts

export interface AgentTool {
  name: string
  description: string                  // 给 LLM 看
  inputSchema: z.ZodSchema             // 校验
  riskLevel: 'low' | 'medium' | 'high'
  reversible: boolean                  // 是否可一键回滚
  estimatedCostImpact: (input: unknown, ctx: PerceiveContext) => number  // USD/天
  execute: (input: unknown, ctx: ExecutionContext) => Promise<unknown>
}
```

### 6.2 Phase 13 上线的 8 个 Tool

| 工具 | 风险 | 描述 |
|---|---|---|
| `pause_campaign` | low | 暂停 campaign（reversible） |
| `resume_campaign` | low | 恢复 campaign |
| `adjust_daily_budget` | medium | 调整日预算（绝对值），需 guardrail 校验幅度 |
| `pause_ad_group` | low | 暂停 ad group |
| `pause_ad` | low | 暂停单条 ad |
| `rotate_creative` | medium | 暂停现有 ad，启用同 ad group 内的备用 creative |
| `flag_for_review` | none | 不执行，仅生成一条人工 review 任务（用于 LLM 不确定时） |
| `noop` | none | 显式声明本周期不行动（用于训练正例） |

### 6.3 Phase 15 追加

| 工具 | 风险 | 描述 |
|---|---|---|
| `start_experiment` | medium | 开启 A/B：复制 ad group + 流量 50/50 + 注入新 creative |
| `conclude_experiment` | medium | 实验显著则 promote winning arm |
| `clone_campaign` | medium | 复制 campaign 到新地区 / 新平台（需审批） |
| `generate_creative_variant` | low | 调 Claude/Seedance 生成创意（只生成不推送，推送另外审批） |
| `push_creative_to_platform` | medium | 把本地 creative 推到平台变成 ad（必走 creative pipeline） |

### 6.4 Phase 16 追加（半自治模式）

| 工具 | 风险 | 描述 |
|---|---|---|
| `adjust_bid` | high | 调整 target CPA / target ROAS / manual CPC |
| `adjust_targeting_geo` | high | 缩小/扩大投放国家 |
| `adjust_targeting_demo` | high | 调整年龄/性别 |
| `enable_smart_bidding` | medium | 切换到平台原生 Smart Bidding |

### 6.5 Tool 实现示例：`adjust_daily_budget`

```ts
// src/lib/agent/tools/adjust-daily-budget.ts

export const adjustDailyBudget: AgentTool = {
  name: 'adjust_daily_budget',
  description: 'Set the daily budget of a managed campaign to a new absolute amount. Use when ROAS is consistently above target (increase) or below floor (decrease).',
  riskLevel: 'medium',
  reversible: true,
  inputSchema: z.object({
    campaignId: z.string(),               // 本地 Campaign.id
    newDailyBudget: z.number().positive(),
    currency: z.string().length(3),
  }),
  estimatedCostImpact: (input, ctx) => {
    const c = ctx.campaigns.find(x => x.id === input.campaignId)
    const current = c?.budget.amount ?? 0
    return input.newDailyBudget - current
  },
  execute: async (input, exec) => {
    const link = await exec.db.platformLink.findFirstOrThrow({
      where: { orgId: exec.orgId, entityType: 'campaign', localEntityId: input.campaignId },
    })
    const adapter = await exec.getAdapter(link.platform as PlatformName)
    await adapter.updateCampaignBudget(link.id, input.newDailyBudget)
    await exec.db.budget.updateMany({
      where: { campaignId: input.campaignId, type: 'daily' },
      data: { amount: input.newDailyBudget },
    })
    return { ok: true, previousBudget: input.previous, newBudget: input.newDailyBudget }
  },
}
```

## 7. Prompt 版本化

```
src/lib/agent/prompts/
  agent.plan/
    v1.md
    v2.md
    INDEX.json     // { default: 2, deprecated: [1] }
  advisor.summary/
    v1.md
```

每次 plan 调用：
1. 加载 default 版本
2. 渲染 → 调 Claude
3. 写 `PromptRun`（保留 90 天）

升级 prompt 时：
1. 写 `v3.md`，先在 INDEX.json 设 `experimental: 3`
2. 把 10% org 流量切到 v3（A/B by orgId hash）
3. 比较 7 天 outcome 分类比例：v3 success - regression > v2 → 切默认

## 8. 失败模式与降级

| 失败 | 检测 | 降级行为 |
|---|---|---|
| LLM 调用超时 | > 30s | 跳过本轮，下小时重试，连续 3 次失败 → 切到规则模式 |
| LLM 返回非法 JSON | parse 失败 | 重试 1 次（带"重新输出有效 JSON"），仍失败 → 跳过 |
| 平台 API 全部失败 | adapter.validateAuth 全部 false | 所有 tool 返回 "not_executable"，仅写 flagged_for_review |
| 连续 3 个 regression | 见 verify | Agent 切到 dry_run 模式，所有 decision 自动 requires_approval=true，通知 ops |
| 超出 LLM 月度预算 | PromptRun cost 累计 | 切到 cheaper model 或仅规则模式 |
| Decision 数突增 | 单 org 单天 > 50 | 限流，超出部分丢弃，写 incident |

## 9. dry-run 模式

每个 org 的 settings 里增加：
- `agent.mode`: `off | shadow | approval_only | autonomous`

| 模式 | 行为 |
|---|---|
| off | 完全不跑 agent loop |
| shadow | 跑完整 perceive→plan→verify 但 act 阶段只写 Decision (status=skipped)，不调平台。用于 onboarding |
| approval_only | 所有 decision 强制 requires_approval=true（即 L2） |
| autonomous | L3：guardrail 通过则自动执行 |

新接入用户默认 `shadow` 1 周 → 看 outcome 分类报告 → 用户主动升级到 `approval_only` 或 `autonomous`。
