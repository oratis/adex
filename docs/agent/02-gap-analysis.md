# 02 · 现状差距分析

> 截至 commit `f574bc9`（Phase 9 完成）的代码盘点。

## 1. 能力矩阵

| 能力域 | 现状评分 | 主要 Gap | 关键文件 |
|---|---|---|---|
| 多平台接入 | 🟢 8/10 | LinkedIn/Amazon 仅 stub；缺 Apple Search Ads / X Ads | [src/lib/platforms/](../../src/lib/platforms/) |
| 数据归集 | 🟡 5/10 | 仅 platform-day 聚合，无 campaign / ad / hour 粒度 | [reports/sync/route.ts](../../src/app/api/reports/sync/route.ts) |
| Campaign 编排 | 🔴 2/10 | launch 仅推空壳；无 targeting / creative / ad 推送 | [campaigns/[id]/launch/route.ts](../../src/app/api/campaigns/[id]/launch/route.ts) |
| 双向同步 | 🔴 0/10 | 平台→本地 0 同步；本地状态变更不打平台 | — |
| AI 建议 | 🟢 7/10 | 工具集仅 2 个；无回看效果学习 | [advisor/route.ts](../../src/app/api/advisor/route.ts) |
| AI 创意 | 🟡 6/10 | Seedance + 文案 ok；缺创意 → ad 推送链路 | [creatives/](../../src/app/api/creatives/) |
| 预算管理 | 🔴 2/10 | `Budget.spent` 从未刷新；无平台预算调整 API | [budgets/route.ts](../../src/app/api/budgets/route.ts) |
| 团队 / 审计 | 🟢 9/10 | 基本完整 | [audit.ts](../../src/lib/audit.ts), [webhooks.ts](../../src/lib/webhooks.ts) |
| 测试 | 🔴 1/10 | 仅 1 个 smoke e2e | [e2e/smoke.spec.ts](../../e2e/smoke.spec.ts) |
| 可观测性 | 🟡 4/10 | 有 audit log 但无指标 / trace / 决策回看 | — |

## 2. 致命断链（必须修，否则任何 agent 都跑不起来）

### 断链 A：本地 status 不打平台

**症状**：用户在 Adex 点 "Pause"，平台上 campaign 仍在烧钱。

**证据**：
- [campaigns/[id]/route.ts:28-44](../../src/app/api/campaigns/[id]/route.ts) `PUT` 只 `prisma.campaign.updateMany`，没调任何 platform client。
- [advisor/apply/route.ts:55-89](../../src/app/api/advisor/apply/route.ts) 同上。
- 各 client 都已实现 `updateCampaignStatus()`：[google.ts:203](../../src/lib/platforms/google.ts), [meta.ts:103](../../src/lib/platforms/meta.ts), [tiktok.ts:106](../../src/lib/platforms/tiktok.ts) — **没有人调用**。

### 断链 B：launch 不带 targeting / ad / creative

**证据**：[campaigns/[id]/launch/route.ts:30-72](../../src/app/api/campaigns/[id]/launch/route.ts)

- Google：`createCampaign` 写死 `DISPLAY` + `PAUSED`；`Campaign.targetCountries / ageMin / ageMax / gender` 字段从未被读取。
- Meta：调 `createCampaign` 但**不调** `createAdSet`（虽然 [meta.ts:57](../../src/lib/platforms/meta.ts) 有实现）。
- 没有任何代码调用 `creativeId` → 把 `Creative` 推到平台变成 `Ad`。

**意味着**：launch 之后用户还要去平台后台做 80% 的工作。

### 断链 C：platformXxxId 字段全部为空

**证据**：grep 整个 `src/`，**没有任何代码** `update Ad/AdGroup/Campaign set platformAdId/platformAdGroupId/platformCampaignId`（除了 launch 时拿到的 platformResponse 也未持久化）。

**后果**：
- 无法从本地 campaign 反查平台 campaign。
- Report 无法按本地 campaign 维度落表。
- Agent 不知道「我之前下过哪个平台动作」。

### 断链 D：Report 只到 platform-day

**证据**：[reports/sync/route.ts:88-152](../../src/app/api/reports/sync/route.ts) `getAggregatedReport` 把整个账号聚合成一行写入 `Report`，`Report.campaignId` 字段虽然存在但全部为 `null`。

**后果**：Advisor 无法说"campaign X 表现差"，因为它根本拿不到 campaign 维度的数据。

## 3. 二级缺口（agent 能跑后才会暴露）

### 缺口 1：Budget.spent 从不刷新
`Budget` 表有 `spent` 字段，但全代码没有任何写入。所以「日预算还剩多少」是个未知数。

### 缺口 2：Advisor 工具集太窄
仅 `pause_campaign` / `resume_campaign`（[advisor/apply/route.ts:48-101](../../src/app/api/advisor/apply/route.ts)）。Agent 化至少需要：
- `adjust_daily_budget`
- `adjust_bid`
- `pause_ad_group` / `pause_ad`
- `rotate_creative`
- `clone_campaign`（用于 A/B）
- `create_ad`（把 Creative 推到平台）

### 缺口 3：rate-limit 是内存级
[rate-limit.ts](../../src/lib/rate-limit.ts) 用 in-process Map，多实例 Cloud Run 上不一致。Agent 自治后调用 LLM 频率会增加 10–100×，必须换成 Redis 或 Cloud Memorystore。

### 缺口 4：sync 是同步阻塞
[reports/sync/route.ts:438-471](../../src/app/api/reports/sync/route.ts) for-loop 串行同步所有平台，单租户多账号下分分钟超时（Cloud Run 默认 60s）。需要队列化（Cloud Tasks 或 BullMQ）。

### 缺口 5：决策无追溯
Advisor 给的建议没有 ID，apply 后只在 audit log 里留一行 `advisor.apply`。无法回答：
- 这条建议是哪次 LLM 调用产出的？
- 用了哪个版本的 prompt？
- 应用后 24h 效果如何？
- 该 prompt 历史平均成功率多少？

### 缺口 6：无 backtesting
没办法「假设当时听了 Agent，现在收益会高/低多少」。Agent 自我进化的前提是有客观的对照组数据。

## 4. 不影响 agent 化、但应顺手解决

- `dev.db` / `prisma/test.db` 还在仓库里（`.gitignore` 应处理）。
- `start.sh` 跑 `prisma migrate deploy` 在多实例并发启动时可能竞争。
- 速率限制错误返回 `Response`，但 [rate-limit.ts](../../src/lib/rate-limit.ts) 的 `rateLimitResponse` 没有 `Retry-After` header。
- `prisma.report.upsert` 用 `${platform}-${orgId}-${endDate}` 拼 ID，迁移到 campaign 粒度后这个 key 会冲突，需要重新设计（见 [04-data-model.md](./04-data-model.md)）。

## 5. 总结：通往 L3 的"必修课"清单

| 优先级 | 工作项 | 对应 Phase |
|---|---|---|
| P0 | 修断链 A、B、C：把平台 update / launch / id 持久化打通 | P10 |
| P0 | 修断链 D：Report 写到 campaign-day 粒度 | P11 |
| P1 | 双向同步：定时拉平台 status / spend 校准本地 | P12 |
| P1 | 把 Advisor 升级为可调用 6 类工具的 Agent Runtime | P13 |
| P1 | Guardrails + 审批队列 + 预算上限 | P14 |
| P2 | 创意 → ad 自动化推送 + A/B 调度 | P15 |
| P2 | 进入 L3 半自治模式（cron 化决策循环） | P16 |
| P3 | 决策回看 + prompt 版本化 + backtesting | P17 |
