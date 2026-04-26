# 04 · 数据模型演进

> 当前 schema 见 [prisma/schema.prisma](../../prisma/schema.prisma)。本章列出所有需要新增/修改的表。所有改动**保持向后兼容**：新字段 nullable、旧数据不强制迁移。

## 1. 一览表

| 改动 | 表 | 类别 | Phase |
|---|---|---|---|
| 新增 | `PlatformLink` | 平台 ID 映射 | P10 |
| 修改 | `Campaign` / `AdGroup` / `Ad` / `Creative` | 状态机 / 同步元数据 | P10 |
| 新增 | `CampaignSnapshot` / `AdGroupSnapshot` | 平台镜像快照 | P12 |
| 修改 | `Report` | campaign 粒度 + 唯一约束改造 | P11 |
| 新增 | `MetricHourly` | 小时级指标（可选，先按需开启） | P13 |
| 新增 | `Guardrail` | per-org guardrail 配置 | P14 |
| 新增 | `Decision` / `DecisionStep` / `DecisionOutcome` | Agent 决策记录 | P13 |
| 新增 | `PendingApproval` | 待审批队列 | P14 |
| 新增 | `Experiment` / `ExperimentArm` | A/B 实验调度 | P15 |
| 新增 | `PromptVersion` / `PromptRun` | LLM 调用版本化 | P17 |
| 新增 | `BudgetCheckpoint` | 日预算重置点（用于 spent 重算） | P12 |

## 2. 核心新增 / 修改详解

### 2.1 PlatformLink（核心、P10 必须）

把"本地实体 ↔ 平台实体"的映射从分散字段抽到独立表。

```prisma
model PlatformLink {
  id              String   @id @default(cuid())
  orgId           String
  platform        String              // google, meta, tiktok, amazon, linkedin
  accountId       String              // 平台账号 ID（Google customerId / Meta act_xxx）
  entityType      String              // campaign, adgroup, ad, creative
  localEntityId   String              // 本地表 PK
  platformEntityId String             // 平台 PK
  status          String   @default("active")  // active, deleted, orphan
  lastSyncedAt    DateTime?
  metadata        String?             // JSON，平台特定字段（如 Meta budget_remaining）
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([platform, accountId, platformEntityId, entityType])
  @@index([orgId, entityType, localEntityId])
}
```

**为什么独立表**：
- 同一本地 campaign 可能复制到多个平台账号（多账号策略）。
- 删除本地实体不必立刻删平台对应物。
- 历史 `Campaign.platformCampaignId` 等字段保留只读，新代码只写 `PlatformLink`。

### 2.2 Campaign / AdGroup / Ad 的状态字段

```prisma
model Campaign {
  // ... 现有字段保留
  desiredStatus    String   @default("draft")  // 用户/Agent 想要的状态
  syncedStatus     String?                     // 上次从平台拉到的状态
  syncedAt         DateTime?                   // 上次同步时间
  syncError        String?                     // 上次同步错误（脱敏）
  managedByAgent   Boolean  @default(false)    // 是否允许 Agent 自动操作
  // ... 关系保留
}
```

**关键改动**：
- `status` 字段语义从「真实状态」改为 `desiredStatus`（期望状态）。
- 新增 `syncedStatus` 表示上次平台真实状态，UI 用「期望→实际」对比展示飘移。
- `managedByAgent`：用户级开关，决定 Agent 是否能自主操作此 campaign。

### 2.3 CampaignSnapshot（P12）

每次 sync 把平台返回的完整 campaign 元数据快照下来，用于：
- diff 检测（手工改了什么）
- 故障回滚（"恢复到昨天"）
- 决策回看的"事实基线"

```prisma
model CampaignSnapshot {
  id            String   @id @default(cuid())
  orgId         String
  platformLinkId String
  capturedAt    DateTime @default(now())
  status        String              // active, paused, removed
  dailyBudget   Float?
  lifetimeBudget Float?
  bidStrategy   String?
  targeting     String?             // JSON
  raw           String              // 完整 JSON

  org          Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  platformLink PlatformLink @relation(fields: [platformLinkId], references: [id], onDelete: Cascade)

  @@index([platformLinkId, capturedAt])
}
```

**保留策略**：每个 campaign 至少留 30 天 + 最近 24 个 snapshot，超出后 thinning（每天保留 1 个）。

### 2.4 Report 改造（P11，**关键**）

#### 现状问题
```prisma
// 当前：每 platform-day 一行
model Report {
  id          String  // 拼装 "${platform}-${orgId}-${date}"
  platform    String
  campaignId  String?  // 字段存在，但永远是 null
  date        DateTime
  // ... metrics
}
```

#### 改造方案

**第一步**（不破坏向后兼容）：保留 Report 表，新增 `level` 字段区分粒度。

```prisma
model Report {
  // ... 字段保留
  level          String   @default("account")  // account | campaign | adgroup | ad
  campaignLinkId String?                        // 指向 PlatformLink (entityType=campaign)
  adGroupLinkId  String?
  adLinkId       String?

  campaignLink   PlatformLink? @relation("CampaignReport", fields: [campaignLinkId], references: [id], onDelete: SetNull)
  // ...

  @@index([orgId, level, date])
  @@index([campaignLinkId, date])
}
```

**第二步**：替换主键策略。当前 `id = ${platform}-${orgId}-${date}` 在 campaign 粒度下会冲突。

```prisma
@@unique([orgId, platform, level, campaignLinkId, adGroupLinkId, adLinkId, date])
// id 改为 cuid，旧 id 字段保留只读供历史数据
```

**第三步**：sync worker 同时写两条 — 一条 `level=account`（兼容现有 dashboard），一条 `level=campaign` 每条 active campaign 一行。

### 2.5 Decision / DecisionStep / DecisionOutcome（P13，Agent 核心）

```prisma
model Decision {
  id              String   @id @default(cuid())
  orgId           String
  triggerType     String              // cron, manual, webhook
  perceiveContext String              // JSON: 喂给 LLM 的上下文摘要
  promptVersion   String              // 关联 PromptVersion.id
  llmRequestId    String?             // Anthropic request_id
  llmInputTokens  Int?
  llmOutputTokens Int?
  rationale       String              // LLM 的"为什么这么做"原文
  severity        String              // info, opportunity, warning, alert
  status          String   @default("pending")  // pending, approved, rejected, executing, executed, failed, rolled_back
  requiresApproval Boolean @default(false)
  approvedBy      String?
  approvedAt      DateTime?
  rejectedReason  String?
  createdAt       DateTime @default(now())
  executedAt      DateTime?

  org      Organization     @relation(fields: [orgId], references: [id], onDelete: Cascade)
  steps    DecisionStep[]
  outcome  DecisionOutcome?

  @@index([orgId, createdAt])
  @@index([status])
}

model DecisionStep {
  id           String   @id @default(cuid())
  decisionId   String
  stepIndex    Int                     // 0,1,2... (一个 decision 可能多步)
  toolName     String                  // pause_campaign, adjust_daily_budget, ...
  toolInput    String                  // JSON
  toolOutput   String?                 // JSON 或错误
  status       String                  // pending, executed, failed, skipped
  guardrailReport String?              // JSON: 哪些 guardrail 通过/失败
  platformResponse String?             // 平台原始返回（脱敏）
  executedAt   DateTime?
  createdAt    DateTime @default(now())

  decision Decision @relation(fields: [decisionId], references: [id], onDelete: Cascade)

  @@index([decisionId, stepIndex])
}

model DecisionOutcome {
  id              String   @id @default(cuid())
  decisionId      String   @unique
  measuredAt      DateTime
  windowHours     Int                  // 一般 24 或 168
  metricsBefore   String               // JSON: 对照基线
  metricsAfter    String               // JSON
  delta           String               // JSON: revenue_delta, spend_delta, roas_delta
  classification  String               // success, neutral, regression, false_positive
  notes           String?              // 人工标注
  createdAt       DateTime @default(now())

  decision Decision @relation(fields: [decisionId], references: [id], onDelete: Cascade)
}
```

### 2.6 Guardrail

```prisma
model Guardrail {
  id          String   @id @default(cuid())
  orgId       String
  scope       String              // global, platform, campaign
  scopeId     String?             // platform name 或 campaign id
  rule        String              // budget_max_daily, budget_change_pct, status_change, ...
  config      String              // JSON: { max: 500, currency: "USD" } 等
  isActive    Boolean  @default(true)
  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId, scope, scopeId])
}
```

**预置 rule 类型**（详见 [07-safety.md](./07-safety.md)）：
- `budget_max_daily` — 单 campaign 日预算硬上限。
- `budget_max_total_daily` — 整个 org 日预算硬上限。
- `budget_change_pct` — 单次调整幅度上限。
- `status_change` — 哪些 status 变更需要审批。
- `requires_approval_above_spend` — 影响金额超过 X 的动作必须审批。
- `agent_active_hours` — Agent 只在工作时间执行（避开 UTC 凌晨）。

### 2.7 PendingApproval

```prisma
model PendingApproval {
  id            String   @id @default(cuid())
  orgId         String
  decisionId    String   @unique          // 1:1 对应一个 Decision
  notifiedAt    DateTime?
  notifiedVia   String?                  // email, slack, webhook
  expiresAt     DateTime                 // 默认 72h，过期 → 自动 reject
  createdAt     DateTime @default(now())

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  decision Decision @relation(fields: [decisionId], references: [id], onDelete: Cascade)

  @@index([orgId, expiresAt])
}
```

### 2.8 Experiment（P15，A/B 实验）

```prisma
model Experiment {
  id              String   @id @default(cuid())
  orgId           String
  campaignLinkId  String                  // 实验作用的 platform campaign
  hypothesis      String                  // "新创意 CTR > 2%"
  status          String   @default("running")  // running, completed, aborted
  startedAt       DateTime
  endsAt          DateTime
  primaryMetric   String                  // ctr, roas, cpa
  minSampleSize   Int      @default(1000)
  result          String?                 // JSON: 哪个 arm 赢了 / 显著性
  createdAt       DateTime @default(now())

  arms ExperimentArm[]

  @@index([orgId, status])
}

model ExperimentArm {
  id            String   @id @default(cuid())
  experimentId  String
  name          String                    // control, variant_a, variant_b
  adLinkId      String                    // 平台 ad
  trafficShare  Float                     // 0.5 = 50%
  metricsSnapshot String?                 // JSON

  experiment Experiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)
}
```

### 2.9 PromptVersion / PromptRun（P17，prompt 版本化）

```prisma
model PromptVersion {
  id        String   @id @default(cuid())
  name      String                       // "agent.plan" / "advisor.summary"
  version   Int                          // 单调递增
  template  String                       // 完整 prompt 文本（可大）
  model     String                       // claude-sonnet-4-5 等
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())

  @@unique([name, version])
}

model PromptRun {
  id              String   @id @default(cuid())
  promptVersionId String
  decisionId      String?              // 哪次 Decision 调用了它
  inputHash       String               // 输入 SHA-256，用于 cache 命中分析
  inputTokens     Int
  outputTokens    Int
  latencyMs       Int
  cost            Float?               // USD
  rawOutput       String               // 模型原文
  parsed          Boolean
  createdAt       DateTime @default(now())

  @@index([promptVersionId, createdAt])
}
```

## 3. 迁移策略

### 3.1 总原则
- **每 Phase 一个迁移**，命名 `YYYYMMDDHHMMSS_phase_NN_description`。
- **新字段全 nullable + default**，绝不要求历史数据回填。
- **数据回填脚本**单独写在 `prisma/backfills/`，由 ops 手动跑（避免 `migrate deploy` 阻塞）。
- **PlatformLink 一次性回填**：从现有 `Campaign.platformCampaignId` 等字段抽取，跑一次性脚本。

### 3.2 Report 改造的灰度方案

最危险的迁移。分 3 步：

1. **MV-only**：新增 `level / campaignLinkId` 字段，sync 仍只写 `level=account`。验证 dashboard 不回归。
2. **双写**：sync 同时写 `level=account` 和 `level=campaign`。Agent 优先读 campaign 粒度。
3. **下线 account 双写**：Dashboard 改为 sum(campaign) 聚合显示，停止 account 级写入。

每步之间 ≥ 1 周观察期。

### 3.3 索引建议

```sql
-- Decision 查询热路径
CREATE INDEX decision_org_status_created ON "Decision" ("orgId", "status", "createdAt" DESC);
CREATE INDEX decision_step_decision ON "DecisionStep" ("decisionId", "stepIndex");

-- Report campaign 粒度查询
CREATE INDEX report_campaignlink_date ON "Report" ("campaignLinkId", "date" DESC);

-- Snapshot 查询
CREATE INDEX snapshot_link_captured ON "CampaignSnapshot" ("platformLinkId", "capturedAt" DESC);
```

## 4. 数据保留策略

| 表 | 保留 | 原因 |
|---|---|---|
| `Report` (account) | 永久 | 量小，BI 用 |
| `Report` (campaign) | 13 个月 | YoY 对比够用 |
| `Report` (adgroup/ad) | 90 天 | 量大，超出后 thinning 到 daily |
| `MetricHourly` | 30 天 | 量极大，仅用于近期决策 |
| `CampaignSnapshot` | 30 天密集 + 12 月稀疏 | 故障回滚 / 趋势 |
| `Decision` + `DecisionStep` | 永久 | 审计 + 训练 |
| `DecisionOutcome` | 永久 | 学习反馈 |
| `PromptRun` | 90 天密集 + 之后只留聚合 | 成本控制 |
| `AuditEvent` | 永久 | 合规 |
