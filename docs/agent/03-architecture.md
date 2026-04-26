# 03 · 目标架构

## 1. 总体分层

```
┌──────────────────────────────────────────────────────────────────┐
│ UI 层 (Next.js App Router)                                       │
│  Dashboard / Campaigns / Advisor / Decisions / Approvals          │
└───────────────────────────────┬──────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│ API 层 (REST under /api/*)                                       │
│  CRUD endpoints + Decision endpoints + Approval endpoints         │
└───────────────────────────────┬──────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│ Agent Runtime ★ (新增)                                            │
│  ┌─────────────┬──────────────┬───────────┬──────────────────┐   │
│  │ Perceive    │ Plan (LLM)   │ Act (Tool)│ Verify (回看)     │   │
│  └─────────────┴──────────────┴───────────┴──────────────────┘   │
│  ↳ Guardrails  ↳ Approval Queue  ↳ Decision Log  ↳ Tool Catalog  │
└────┬──────────────────────┬─────────────────────────┬────────────┘
     │                      │                         │
┌────▼─────┐          ┌─────▼──────┐          ┌──────▼────────┐
│ Sync     │          │ Platform   │          │ Creative      │
│ Workers  │          │ Adapter    │          │ Pipeline      │
│ (queue)  │          │ (统一接口) │          │ (Seedance/AI)  │
└────┬─────┘          └─────┬──────┘          └──────┬────────┘
     │                      │                         │
┌────▼──────────────────────▼─────────────────────────▼─────────┐
│ 外部 API: Google Ads / Meta / TikTok / Amazon / LinkedIn /     │
│           AppsFlyer / Adjust / Anthropic / GCS                 │
└────────────────────────────────────────────────────────────────┘

         共享基础: Postgres (Prisma) · Redis · Cloud Tasks · Cloud Storage
```

★ = 本方案新增的核心模块。

## 2. 关键模块职责

### 2.1 Platform Adapter（执行层重构）

**位置**：`src/lib/platforms/*` → 重构为 `src/lib/platforms/<name>/{client.ts, adapter.ts}`

**为什么**：当前每个平台 client 接口形状不一致，Agent Runtime 没法统一调用。引入 **`PlatformAdapter` 接口**作为唯一抽象。

```ts
interface PlatformAdapter {
  readonly platform: 'google' | 'meta' | 'tiktok' | ...

  // ========== 写操作（Agent 可调用） ==========
  launchCampaign(input: LaunchCampaignInput): Promise<LaunchResult>
  updateCampaignStatus(platformCampaignId: string, status: 'active'|'paused'): Promise<void>
  updateCampaignBudget(platformCampaignId: string, daily: number): Promise<void>
  createAdGroup(input: CreateAdGroupInput): Promise<{ platformAdGroupId: string }>
  createAd(input: CreateAdInput): Promise<{ platformAdId: string }>
  pauseAd(platformAdId: string): Promise<void>
  // ... 见 06-agent-loop.md 工具表

  // ========== 读操作（Sync Worker 调用） ==========
  fetchCampaignList(): Promise<PlatformCampaignSnapshot[]>
  fetchCampaignReport(campaignIds: string[], range: DateRange): Promise<CampaignReport[]>
  fetchAccountReport(range: DateRange): Promise<AccountReport>
}
```

**实现要点**：
- 每个 adapter 自己处理 token refresh、rate limit、错误归一化。
- 输入输出都用本仓库定义的中性类型（`LaunchCampaignInput` 等），平台细节封装在 adapter 内。
- 失败统一抛 `PlatformError`，带 `code: 'rate_limit' | 'auth_expired' | 'invalid_argument' | 'platform_outage' | 'unknown'`，让上层决定重试策略。

### 2.2 Sync Workers（异步队列）

**位置**：`src/lib/workers/sync-worker.ts` + Cloud Tasks 触发器

**为什么**：现在 sync 是同步阻塞，单个 org 多账号 / 多平台超 60s 就 timeout。

**设计**：
- **Job 类型**：`sync.account`（粗粒度，每 org-platform 一个 job）、`sync.campaigns`（细粒度，每 platform-campaign 一批）。
- **触发**：cron 每小时入队所有活跃 org 的 `sync.account`；UI 手动 sync 走同样队列。
- **执行**：Worker 调用 PlatformAdapter 的 fetch 方法，写 `Report` + `Snapshot`（见 04 章）。
- **重试**：`code: 'rate_limit'` 指数退避；`auth_expired` 通知用户重连，不重试。
- **去重**：每个 job 带 `idempotencyKey = ${orgId}-${platform}-${range}`。

### 2.3 Agent Runtime（决策核心）

**位置**：`src/lib/agent/*`

```
src/lib/agent/
  loop.ts            // 主循环：perceive → plan → act → verify
  perceive.ts        // 拉过去 N 天的 campaign-day 报表 + 当前 status + budget
  plan.ts            // 调 LLM，输出结构化 Decision[]
  act.ts             // 把 Decision 翻译成 Tool 调用，过 guardrail，写 Decision Log
  verify.ts          // 24h / 7d 后回看每个 Decision 的效果，写回 Decision Log
  guardrails.ts      // 校验 Tool 调用是否被允许
  tools/             // 每个 Tool 一个文件：pause_campaign.ts, adjust_budget.ts, ...
  prompts/           // 版本化 prompt 模板
```

**Decision 流程**：

```
Cron (每小时)
   │
   ▼
┌──────────────┐    perceive      ┌─────────────────────────┐
│ For each org │ ───────────────▶ │ Fetch reports (24h+7d)  │
└──────────────┘                  │ Fetch campaign snapshots │
   │                              │ Fetch active guardrails  │
   ▼                              └────────────┬─────────────┘
   │                                            │
   │             plan (LLM with tools)          ▼
   │       ┌─────────────────────────────────────────┐
   │       │ Claude prompt: "Here's data + tools.   │
   │       │ What should we do? Return Decision[]." │
   │       └────────────────────┬────────────────────┘
   ▼                            │
   │     act                    ▼
   │     ┌──────────────────────────────────────────────┐
   │     │ For each decision:                           │
   │     │   1. validate (guardrail check)              │
   │     │   2. if requires_approval → enqueue + notify │
   │     │   3. else → call PlatformAdapter             │
   │     │   4. write DecisionLog                        │
   │     │   5. fire webhook                             │
   │     └──────────────────────────────────────────────┘
   ▼
   │     verify (24h 后另一个 cron 触发)
   │     ┌──────────────────────────────────────────────┐
   │     │ For each Decision in last 7 days:            │
   │     │   compare metrics before vs after            │
   │     │   write DecisionOutcome                       │
   │     │   feed back into next plan() prompt          │
   │     └──────────────────────────────────────────────┘
```

### 2.4 Approval Queue

**位置**：`src/app/(dashboard)/approvals/`、`src/app/api/approvals/`

**数据**：见 [04-data-model.md](./04-data-model.md) 的 `PendingApproval` 表。

**通知**：通过现有 [webhooks.ts](../../src/lib/webhooks.ts) + 邮件发送 Slack/Email 通知。

**审批 UI**：决策卡片（建议、原因、影响范围、to-be 状态预览）+ Approve / Reject / Edit 按钮。

### 2.5 Creative Pipeline

**位置**：`src/lib/creative-pipeline/*`

**职责**：把 `Creative` 推到平台变成 `Ad`：
1. 校验素材规格（尺寸 / 时长 / 格式）符合目标平台要求。
2. 上传到平台资产库（Google MediaService / Meta `/adimages` / TikTok upload）。
3. 调用 PlatformAdapter.createAd 关联 ad group。
4. 写回 `Ad.platformAdId`。

**触发场景**：
- 用户在 UI 手动「关联到 campaign」。
- Agent 决定 `rotate_creative` / `create_ad`。

## 3. 数据流（一次自治决策的完整链路）

以「Agent 自动暂停一个低 ROAS campaign」为例：

```
T+0   Cron 触发 perceive
T+1s  Sync Worker 已经在 N 分钟前更新了 campaign-day Report
T+2s  Plan 阶段：把过去 7d × 全部 campaign 的指标喂给 Claude
T+5s  Claude 返回 Decision { tool: pause_campaign, campaignId: X, reason: "ROAS 0.4×" }
T+5s  Guardrail 检查：被允许（pause 是低风险动作）→ 不需审批
T+5s  Act 阶段：
       1. 写 DecisionLog (status=executing)
       2. 调用 GoogleAdsAdapter.updateCampaignStatus(platformCampaignId, 'paused')
       3. 更新本地 Campaign.status = 'paused'
       4. 写 AuditEvent
       5. 发 webhook "campaign.paused_by_agent"
       6. 写 DecisionLog (status=executed, outcome_at=T+24h)
T+24h Cron 触发 verify
       1. 读 DecisionLog where outcome_at <= now AND outcome IS NULL
       2. 对比 pause 前 7d vs pause 后 24h 的浪费支出
       3. 写 DecisionOutcome { saved_spend: $42.10, false_positive: false }
       4. 喂回下次 plan() 作为「过去成功案例」
```

## 4. 关键技术抉择

| 抉择 | 选项 | 推荐 | 理由 |
|---|---|---|---|
| 队列 | Cloud Tasks / BullMQ / Pub-Sub | **Cloud Tasks** | 已在 GCP，无需新组件；HTTP 触发兼容 Cloud Run |
| 缓存 / 分布式锁 | Redis / Memorystore / Postgres advisory lock | **Memorystore** | rate limit + 分布式锁；规模小可暂用 Postgres advisory lock |
| LLM 调用 | Anthropic 直连 / Bedrock / Vertex | **Anthropic 直连** | 已接，prompt caching 支持好 |
| Agent 框架 | LangChain / 自研 / Anthropic Agent SDK | **自研薄层 + Anthropic tool use** | 框架重，自研可控；只需 ~500 行 |
| Decision 存储 | Postgres / 时序 DB | **Postgres** | 量级（每 org 每天 ~50 决策）够用 |
| 平台 ID 持久化 | 各 platform*Id 字段（现状） / 单独 PlatformLink 表 | **PlatformLink 表** | 一个本地实体可能对应多平台镜像（如复制 campaign），见 04 章 |

## 5. 与现有代码的兼容策略

- **不破坏 UI**：现有 dashboard 仍能跑；新增 `/decisions`、`/approvals` 路由。
- **现有 Advisor 平稳过渡**：保留 `/api/advisor` 作为 L1 接口；新增 `/api/agent/decisions` 作为 L2/L3 接口。Phase 13 之后 Advisor 内部 delegate 给 Agent Runtime。
- **Schema 演进可逆**：所有新增字段 nullable，旧数据不迁移；具体见 04 章。
- **逐平台开放**：新 PlatformAdapter 接口先在 Google 上跑通，再逐步迁移 Meta / TikTok。每个平台升级期间，旧 client 仍可读。
