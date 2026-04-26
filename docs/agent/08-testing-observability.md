# 08 · 测试与可观测性

## 1. 测试金字塔

```
                     ▲
                    ╱ ╲
                   ╱E2E╲              ~10 个 critical path
                  ╱─────╲
                 ╱        ╲
                ╱Integration╲          ~50 个，每平台/每 tool
               ╱─────────────╲
              ╱               ╲
             ╱      Unit       ╲       ~500 个，guardrails / parsers / adapters
            ╱───────────────────╲
           ╱                     ╲
          ╱   LLM Eval (新增)     ╲    ~30 个 prompt fixture
         ╱─────────────────────────╲
```

## 2. Unit Tests

**框架**：Vitest（轻量、Vite-native，对 TS/ESM 友好）。

### 2.1 必须覆盖

| 模块 | 关键测试 |
|---|---|
| `src/lib/agent/guardrails.ts` | 每条 rule 的 boundary case |
| `src/lib/agent/tools/*.ts` | inputSchema 拒绝非法输入 / `estimatedCostImpact` 计算正确 |
| `src/lib/platforms/*/adapter.ts` | 用 nock/msw mock 平台 API，断言 request body |
| `src/lib/agent/plan.ts` | LLM mock 返回各种格式，验证 parse + validate |
| `src/lib/agent/verify.ts` | metrics delta 计算 / 分类逻辑 |
| `src/lib/rate-limit.ts` | 切换到 Redis 后的并发安全 |

### 2.2 示例

```ts
// src/lib/agent/guardrails.spec.ts
describe('budget_change_pct_per_day', () => {
  it('rejects 50% increase when limit is 30%', async () => {
    const ctx = makeCtx({ campaign: { budget: 100, recentChanges: [] } })
    const r = await evaluators.budget_change_pct_per_day(
      { tool: 'adjust_daily_budget', input: { newDailyBudget: 150 } },
      ctx,
      { maxPct: 30 }
    )
    expect(r.ok).toBe(false)
    expect(r.blockingMode).toBe('reject')
  })

  it('counts cumulative changes within 24h', async () => {
    const ctx = makeCtx({ campaign: { budget: 100, recentChanges: [{ delta: 0.20, at: hoursAgo(2) }] } })
    const r = await evaluators.budget_change_pct_per_day(
      { tool: 'adjust_daily_budget', input: { newDailyBudget: 115 } }, // 已 +20%, 再 +15% = 35% 超限
      ctx,
      { maxPct: 30 }
    )
    expect(r.ok).toBe(false)
  })
})
```

## 3. Integration Tests

### 3.1 Adapter contracts
每个 PlatformAdapter 有一组 contract tests，确保实现满足接口承诺。

```ts
// src/lib/platforms/__contract__/run.ts
import { runAdapterContract } from './contract'
import { GoogleAdsAdapter } from '../google/adapter'

runAdapterContract('google', () => new GoogleAdsAdapter(mockAuth, 'org_test', mockDb))
```

contract 测试覆盖：
- launchCampaign → 写回 PlatformLink
- updateCampaignStatus → 二次 fetch 看到 status 一致
- updateCampaignBudget → 平台 API 收到正确 body
- 所有方法在 `rate_limit` 错误下退避重试
- `auth_expired` 触发 refreshAuth

### 3.2 端到端 Decision flow
用 Playwright + 真实 sandbox 账号（Google Ads test account）：

```
Test: agent_pauses_low_roas_campaign
  Setup: 在 Google Ads test account 创建 campaign，注入 7 天假数据让 ROAS=0.3
  When:  POST /api/internal/agent/run-loop?orgId=test-org
  Then:  Decision 表新增 1 行 status=executed, tool=pause_campaign
         Google Ads test account 上该 campaign status=PAUSED
         AuditEvent 新增 'agent.execute' 事件
         Webhook 收到 'campaign.paused_by_agent'
```

### 3.3 关键路径 e2e（必须）

| 路径 | 频率 |
|---|---|
| 注册 → 连接 Google → launch campaign → 平台真实出现 | 每次 PR |
| sync → Report 出现 campaign 粒度行 | 每次 PR |
| Agent shadow mode 跑一轮，Decision 落库但不调平台 | 每次 PR |
| Guardrail 阻止 → PendingApproval 创建 + 通知 | 每次 PR |
| 审批通过 → Decision 状态推进 → 平台真实变化 | 每次 PR |
| Kill switch 触发 → 后续 cron 跳过 | 每周 |

## 4. LLM Eval（决策质量）

> LLM 是非确定性的。需要专门的 eval 框架来回答："改 prompt 后，是不是真的更好？"

### 4.1 Eval Dataset
```
evals/agent-plan/
  fixtures/
    case_001_high_roas_scale_opportunity.json
    case_002_low_roas_should_pause.json
    case_003_inconclusive_data_should_noop.json
    ...30 cases
  expected/
    case_001.expected.json   // 期望的 tool sequence (allow set, not exact)
```

每个 fixture 含完整 `PerceiveContext`，expected 描述：
- `must_call`: 必须调用的 tool（可多个 OK，无序）
- `must_not_call`: 绝不能调用的 tool
- `severity_floor`: severity 至少多高
- `rationale_must_mention`: rationale 必须含的关键字（如具体数字）

### 4.2 Eval runner
```bash
npm run eval:agent-plan -- --prompt-version=2
```
输出：
```
30 cases · v2 prompt · claude-sonnet-4-5

✓ case_001 (must_call=adjust_daily_budget)
✗ case_002 (expected pause_campaign, got noop)
✓ case_003 (correctly noop)
...

Pass rate: 27/30 (90%)
Cost: $0.42  Avg latency: 3.2s
```

### 4.3 Regression gate
PR 修改 prompt → CI 自动跑 eval → 如 pass rate 下降 > 5pp，阻止合并。

## 5. Observability

### 5.1 关键指标（Cloud Monitoring / Grafana）

| 指标 | 类型 | 告警 |
|---|---|---|
| `agent.loop.duration_seconds` | histogram | p95 > 60s |
| `agent.decisions_executed_total` | counter | / |
| `agent.decisions_blocked_total{reason}` | counter | guardrail block ratio > 50% 持续 1h |
| `agent.outcomes_total{classification}` | counter | regression rate > 20% 7d 滚动 |
| `platform.api.errors_total{platform,code}` | counter | rate_limit > 100/h |
| `platform.sync.lag_seconds` | gauge | > 7200 (2h) |
| `llm.requests_total{prompt,version,outcome}` | counter | parse_failed > 5% |
| `llm.cost_usd_total{org}` | counter | per-org budget |
| `approval.pending_total` | gauge | > 50 持续 12h |
| `approval.median_response_minutes` | gauge | > 240 |

### 5.2 Tracing
- 每个 plan → act 链路一个 trace（OpenTelemetry）
- trace_id 写入 `Decision.metadata`，UI 上提供「在 Cloud Trace 里查看」链接

### 5.3 决策回看 UI
`/decisions` 页：
- 列表：日期 / 触发 / tool / target / status / outcome
- 筛选：org × campaign × tool × outcome classification × 时间
- 详情卡片：完整 perceive context、prompt 版本、LLM 原文、guardrail 报告、平台响应、outcome

### 5.4 Agent 周报（自动）
每周一自动给 org admin 发：
```
本周 Adex Agent 报告 · {{org}}

总览：
  做了 47 个决策（人工审批 12 / 自动 35）
  outcome 分类：success 28 · neutral 15 · regression 4
  净影响：节省 $342 spend，新增 $1,180 revenue
  ROAS 提升：+12% vs 基线

需要你关注：
  ⚠ 4 个 regression 决策（详情：...）
  ⚠ 8 个待审批超过 48h
  ⚠ Campaign "Q4 Brand" 连续 3 周低 ROAS，建议人工评估

本周 Agent 没做的事（参考）：
  - 你手动改了 5 个 budget（Agent 因 'budget_change_min_interval' 未行动）
  - 3 个 campaign 因 managedByAgent=false 完全未介入
```

## 6. Chaos Testing

每月一次手动演练：

| 场景 | 期望行为 |
|---|---|
| Anthropic 全挂 1 小时 | Agent 跳过该 org，下次重试，不影响 sync |
| Google Ads 大面积 5xx | Adapter 退避后失败，写 incident，无错误状态污染本地 DB |
| Postgres 主备切换 | 任何运行中 decision 不丢失（事务回滚），下次 cron 重做 |
| Cloud Tasks 队列堆积 | sync 滞后 → guardrail `min_sync_freshness` 拦住 act |
| 单条 prompt 注入攻击（恶意 campaign name） | LLM 输出仍通过 schema 校验，不会执行非法 tool |

## 7. 性能基线

| 操作 | SLO | 测量 |
|---|---|---|
| sync.account（单 org 单平台） | p95 < 30s | Cloud Tasks task duration |
| agent.loop（单 org） | p95 < 60s | trace duration |
| /api/decisions 列表 | p95 < 500ms | Cloud Monitoring |
| /api/approvals 操作（approve/reject） | p95 < 2s | 同上 |
| Decision 数据库行数（per org per day） | < 200 | guardrail 限流 |

## 8. CI / CD 改造

### 现有
- lint + tsc + next build（[.github/workflows/ci.yml](../../.github/workflows/ci.yml)）

### 新增
1. `npm run test`（Vitest unit）— 必须 pass
2. `npm run test:integration`（contract tests，用 mock，不需要真账号）
3. `npm run eval:agent-plan -- --gate`（仅当 PR 改了 prompts/）
4. `npm run test:e2e`（Playwright，nightly + 手动）

### Deploy gates
- 主分支必须通过所有 1-3 步
- prod deploy 前必须 1 人 approval
- prod deploy 后自动跑 smoke e2e（`/api/health` + 一次 dry-run agent loop）
