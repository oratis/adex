# Adex 测试指南

> 给第一次接触 Adex 的人一份"从零到把所有功能都摸一遍"的剧本。每一节都给出具体动作和"应该看到什么"。

线上地址：<https://adexads.com>

## 目录

1. [前置准备](#1-前置准备)
2. [账号 + 组织](#2-账号--组织)
3. [连接广告平台](#3-连接广告平台)
4. [创建第一条 Campaign](#4-创建第一条-campaign)
5. [创意素材](#5-创意素材)
6. [同步数据 + Dashboard](#6-同步数据--dashboard)
7. [Advisor（轻量 AI 建议）](#7-advisor轻量-ai-建议)
8. [开启 Agent（shadow 模式）](#8-开启-agentshadow-模式)
9. [审批模式（approval_only）](#9-审批模式approval_only)
10. [Guardrails 配置](#10-guardrails-配置)
11. [创意自动化 + Review](#11-创意自动化--review)
12. [A/B 实验](#12-ab-实验)
13. [高风险 Tool + 自治模式](#13-高风险-tool--自治模式)
14. [Prompt 版本化 + Backtest](#14-prompt-版本化--backtest)
15. [Webhook + Slack 接入](#15-webhook--slack-接入)
16. [可观测性面板](#16-可观测性面板)
17. [回滚 + Kill Switch](#17-回滚--kill-switch)
18. [运维 + cron](#18-运维--cron)
19. [常见问题](#19-常见问题)

---

## 1. 前置准备

需要的东西：

| 必需 | 说明 |
|---|---|
| Adex 账号 | 在 <https://adexads.com> 注册（如果你已有 OAuth/邮箱密码登录就直接用） |
| Anthropic API key | 已配置在 `ANTHROPIC_API_KEY` 环境变量。**没有的话 Agent 会跑 pass-through 模式（只输出 noop），其他功能不受影响** |
| Slack Incoming Webhook URL（可选） | 用于测通知；不接也能跑 |
| SMTP（可选） | 测邮件审批通知；不配则只在 UI 看 |

可选但强烈推荐——一个测试用的 Google Ads / Meta / TikTok 账号。**注意：所有 launch / pause 都会真实打到平台，第一次必须用 sandbox 或低预算账号**。

---

## 2. 账号 + 组织

1. 访问 <https://adexads.com>
2. **新账号**：点 "Register"，邮箱+密码注册；自动建一个 personal org
3. **已有账号**：登录后看右上角 workspace 切换；可以建多个 org 来隔离测试 vs 生产
4. 进 `/settings → Members` 邀请别人测多人审批流（owner / admin / member 三种角色）

**预期**：登录后落到 `/dashboard`，左侧栏 18 个入口（Dashboard / Campaigns / Seedance2 / Assets / Creatives / Budget / Advisor / Decisions / Approvals / Guardrails / Experiments / Prompts / LLM cost / Agent stats / Onboarding / Webhooks / Creative review / Orphan campaigns / Audit log / Settings）。

---

## 3. 连接广告平台

进 `/settings → Platform Auth`：

| 平台 | 怎么接 | 测试技巧 |
|---|---|---|
| Google Ads | OAuth 流程，需要 MCC ID + Developer Token + 你的 OAuth Client | 用 [Test Account](https://developers.google.com/google-ads/api/docs/start) 搞一个零预算的 test customer，所有调用真实但不花钱 |
| Meta | Access Token + Ad Account ID（`act_xxx`） | 用 sandbox account：<https://developers.facebook.com/tools/sandbox/> |
| TikTok | Access Token + Advertiser ID | TikTok Marketing API sandbox 注册即送 |
| Amazon | Access Token + Profile ID + LWA Client ID + secret | Amazon Ads sandbox |
| LinkedIn | Access Token + Account URN | 同上 |
| AppsFlyer / Adjust | API Token + App ID/Token | 只读 MMP 数据，不会做任何写入 |

**预期**：连接成功后回到 settings 看到绿色 "Connected" 标识；列出账号 ID 和最后同步时间。

---

## 4. 创建第一条 Campaign

进 `/campaigns` → "+ New Campaign"：

```
Name:       Test pause 用例
Platform:   google
Objective:  awareness
Targeting:  US, age 25–45, all
Budget:     daily $10
Start:      今天
```

保存后 status=`draft`。点 **"Launch"** — 这会调 `POST /api/campaigns/[id]/launch` → 走 `GoogleAdsAdapter.launchCampaign` → 在 Google Ads test account 真的建一个 campaign（PAUSED 状态）+ 写一条 `PlatformLink` 行。

**预期**：
- UI status 翻成 `active`，但**头部 badge 应显示 "desired: active · platform: paused"**（agent 拒绝在没有 ad group 的情况下激活，平台也确认在 paused）
- 进 `/campaigns/{id}` 看到 desired/synced 两个 badge
- 在 Google Ads UI 里能看到这条 campaign 真的存在

**故意触发错误**：故意填一个无效的 destination URL，launch 应该返回 502 + 把错误写到 `Campaign.syncError`，UI 弹黄色横幅。

### 批量操作

回 `/campaigns`，把多条 draft 全选，顶部蓝条点 "Pause selected" — 走 `/api/campaigns/bulk-status`，应该返回 per-id 结果，UI 局部更新。

---

## 5. 创意素材

两条路径：

**A. 上传**
1. `/assets` → "Upload"
2. 拖一张图片（≤ 10MB）
3. 上传到 GCS bucket `adex-data-gameclaw`，UI 显示缩略图

**B. AI 生成**
1. `/seedance2` → "Generate Video"
2. Prompt: "summer fashion ad, beach scene, energetic"
3. 30s–2min 后状态从 `generating` → `ready`，可下载

把素材关联到 ad：
1. `/creatives` → 点素材 → "Attach to ad"
2. 选刚才的 campaign，自动建 ad group（如果没有）+ ad

---

## 6. 同步数据 + Dashboard

进 `/dashboard` → 点 "Sync Data"。

**实际发生的事**：
- 走 `/api/reports/sync`，遍历所有 active platformAuth
- 每个 adaptable 平台调 `runAdapterSync`：写 `Report level=account`（兼容老 dashboard）+ `Report level=campaign`（每条 campaign 一行，带 `campaignLinkId`）
- 同步完触发 `Budget.spent` 重算

**预期**：
- 7 天 trend 曲线刷新
- `/budget` 上的 `spent` 数字开始 ≠ 0（新功能！之前永远是 0）
- 进 `/api/agent/cost`（如果开了 agent）能看到本月的 LLM 成本

**测验证 P11**：在 SQL 里直接查 `SELECT level, count(*) FROM "Report" GROUP BY level;` 应该看到 `account` 和 `campaign` 两种行。

---

## 7. Advisor（轻量 AI 建议）

进 `/advisor` → 点 "Get advice"。

调 `/api/advisor` → 把 7 天指标喂给 Claude → 返回 3–6 条建议（severity + 可选 action）。

**测试场景**：
- 让某条 campaign 数据变差（手动改个低 ROAS 标记），advisor 应该返回 `severity=alert` 的暂停建议
- 点建议旁的 "Apply" 按钮 → 调 `/api/advisor/apply` → 走 `applyCampaignStatusChange` → 真的暂停 + audit log

---

## 8. 开启 Agent（shadow 模式）

这是核心新功能，**安全的第一步**：agent 跑完整 plan-act-verify 循环但所有 tool 不真执行。

1. 进 `/agent-onboarding`
2. 点 **"Enable agent (starts shadow)"** — 这一步同时打开 `enabled=true` 和记录 `shadowStartedAt`
3. 进 `/decisions` 点 **"Run now"** — 立即跑一次 agent loop（不用等 cron）

**预期**：
- 1–10s 后弹窗：`Created N · Skipped N`（shadow 模式所有 step 都 skip）
- 列表多出 N 条决策；展开看 rationale + steps
- 点 **"Open page →"** 跳到独立详情页，能看完整 perceiveContext + step input + guardrail report

**调小 LLM 预算来测限流**：进 `/agent-onboarding` 改 `monthlyLlmBudgetUsd: 1`，再 "Run now" → guardrail `llm_budget_cap` 阻止 plan() 调用，决策 0 条。

**故意制造无信号场景**：先 archive 所有 campaign，再 "Run now" → agent 应返回 1 条 `noop` 决策，rationale 解释为什么没事可做。

### 看 stats

进 `/agent-stats` → 应该看到：
- `decisionsTotal`、`bySeverity`、`byMode={shadow: N}`、`topTools`
- `outcomes` 现在还是空（verify cron 24h 后才有数据）
- `approvalLatency` 显示 sample 0（还没人工审批过）

进 `/agent-cost` → 当月 LLM cost、按 prompt 版本分组、按日表格。

---

## 9. 审批模式（approval_only）

shadow 跑了至少 7 天后（开发测试可改源码降到 1 分钟），允许升级。

1. `/agent-onboarding` → "Promote to approval_only"
   - 如果 dwell time 不够 UI 会显示剩余小时，按钮灰
   - 满足后会成功，UI 显示 "currently approval_only"
2. 点 "Run now" → 决策不再被 skip，而是 status=`pending`，进 `/approvals`
3. `/approvals` 看到决策卡片 + 步骤详情 + 每条 step 的 guardrail 报告
4. **逐条**：点 "Approve & run" → 调用 `executeApprovedDecision` 真实跑 tool；或 "Reject" + 填理由
5. **批量**：勾左边 checkbox 多选 → 顶部 "Approve selected" / "Reject selected"

**邮件测试**：在 `/settings` 给 owner 配 `dailyReportEmail`。下次 `agent.approval.requested` 触发时（即下次 plan() 输出新的 pending decision）应该收到邮件，含 rationale + steps + 直链 `/approvals`。

**72h 过期测试**：让某条 pending 等 ≥ 72h（或改 `pendingApproval.expiresAt` 直接调到过去），下一次 `/api/cron/agent-expire` 跑完时应自动 reject。

---

## 10. Guardrails 配置

进 `/guardrails` → 默认列表为空，但**12 条内建 evaluator 始终生效**（说明文字下拉框里全列）。点 "+ New guardrail" 加自定义：

### 几个值得测的场景

| 规则 | config 示例 | 预期效果 |
|---|---|---|
| `budget_max_daily` | `{ "max": 100 }` | 任何 `adjust_daily_budget` 步骤超过 100 立即 block |
| `budget_change_pct` | `{ "maxIncreasePct": 30, "maxDecreasePct": 50 }` | 单次预算 +30% / -50% 以外的变更 block |
| `agent_active_hours` | `{ "startHourUtc": 1, "endHourUtc": 23 }` | 制造 UTC 0–1 点窗口外 → 所有 plan 都被 block |
| `requires_approval_above_spend` | `{ "threshold": 50 }` | 任何 \|Δbudget\| ≥ 50 强制走 approval_only（即使 mode=autonomous） |
| `cooldown` | `{ "hours": 1 }` | 同一 step 1 小时内重复直接 block |

每个规则在 DecisionStep.guardrailReport 里都会留一条 `{rule, pass, reason}`，UI 可以展开看。

---

## 11. 创意自动化 + Review

测试 LLM → 平台的完整链路（**P15 核心**）：

1. 找一条 CTR 低的 campaign（手动 fudge metrics 也行）
2. 在 `/decisions` "Run now"，agent 可能输出 `generate_creative_variant` 步骤
   - 创建一条 `Creative` 行，`reviewStatus='pending'`
   - 触发 `creative.review_requested` webhook（Slack 应该响）
3. 进 `/creatives/review?status=pending` 看到新创意
4. 点 "Approve" → `reviewStatus='approved'`
5. 现在 agent 可以提议 `push_creative_to_platform` step
6. 该 tool 调 adapter 上传到 Meta `/adimages` 或 TikTok asset library，写 `Creative.platformAssetId` + `PlatformLink(entityType=creative)`

**故意触发 reject 路径**：拒绝创意 → `reviewStatus='rejected'`，agent 后续 push 步骤失败时返回错误 "reviewStatus=rejected; must be 'approved' before push"。

### 测平台政策事件

模拟平台返回拒绝：
```bash
curl -X POST https://adexads.com/api/platforms/policy-events \
  -H "X-Adex-Inbound-Signature: sha256=$(echo -n '{"orgId":"<your-org>","platformAdId":"<ad>","status":"rejected","reason":"misleading claim"}' | openssl dgst -sha256 -hmac "$INBOUND_WEBHOOK_SECRET" -hex | awk '{print $2}')" \
  -H "Content-Type: application/json" \
  -d '{"orgId":"<your-org>","platformAdId":"<ad>","status":"rejected","reason":"misleading claim"}'
```

预期：响应 `ok:true, updated:1, flagged:true`；webhook 触发 `ad.policy_rejected`；audit log 多一行。

---

## 12. A/B 实验

需要至少 2 个 PlatformLink (entityType=ad 或 adgroup) 才能测。

**手动创建实验**：
```bash
curl -X POST https://adexads.com/api/agent/experiments \
  -H "Cookie: <your-session>" -H "Content-Type: application/json" \
  -d '{
    "campaignLinkId": "<campaign-link-id>",
    "hypothesis": "Headline B drives 20% better CTR than A",
    "primaryMetric": "ctr",
    "durationHours": 168,
    "minSampleSize": 1000,
    "arms": [
      {"name":"control","adLinkId":"<link1>","trafficShare":0.5},
      {"name":"variant","adLinkId":"<link2>","trafficShare":0.5}
    ]
  }'
```

**Agent 自己起实验**（更有意思）：用 `start_experiment` tool 的 `cloneFromAdGroupLinkId` 模式 — agent 调 adapter 复制源 ad group 到同 campaign，自动 50/50 分流。

**结束实验**：`/experiments` → "Conclude now" 跑两比例 z-test，结果存到 `Experiment.result`，winner 高亮。

**z-test 验证**：可在 `npm test -- significance` 看 6 个单元测试。

---

## 13. 高风险 Tool + 自治模式

### 启用自治

1. **Owner-only**：进 `/agent-onboarding` → "Grant" allowlist 按钮（admin 看不到，owner 才能批准自己 org 进 autonomous）
2. approval_only 跑满 14 天后，"Promote to autonomous" 才会变可点
3. 点击升级 → mode=`autonomous`

### 4 个高风险 tool

`adjust_bid` / `enable_smart_bidding` / `adjust_targeting_geo` / `adjust_targeting_demo`

**默认全部需要审批**（`high_risk_requires_approval` guardrail）。要让它们在 autonomous 模式下不审批：去 `/guardrails` 把这条规则禁用，但**强烈建议**同时配紧的 `budget_change_pct` + `requires_approval_above_spend` 兜底。

### 自动降级测试

人为构造连续 3 次 regression：
1. 在 `Decision` 表跑 N 个 status=executed 决策
2. 在 `DecisionOutcome` 表手动 insert 3 条 `classification='regression'`
3. 跑下次 `/api/cron/agent` → `safeguards.checkRegressionDowngrade` 触发 → mode 从 autonomous 降到 approval_only，发 `agent.killswitch.activated` webhook

---

## 14. Prompt 版本化 + Backtest

进 `/prompts`：

### 创建新版本

1. "+ New version"
2. Name: `agent.plan` / Model: `claude-sonnet-4-5`
3. Template 复制 [src/lib/agent/prompts/plan.v1.md](../src/lib/agent/prompts/plan.v1.md) 改一两个字（比如把 "Quality over quantity" 改成 "Always pick at least one tool"）
4. 选 **isExperimental + experimentalSharePct=10** → 创建
5. 立即生效：10% 的 org（按 `orgId` SHA-256 hash mod 100）下次 plan() 会用 v2

### Backtest

`/prompts` 找到 v2 → 点 "Backtest 7d"
- 调 `/api/agent/backtest`，重放过去 7 天的 perceive snapshot
- 返回 `summary: { same_tools, tool_set_changed, no_action_now, error }`
- 验证 v2 vs v1 的 tool 选择差异 — 决定是否 promote

### 推全 / 回滚

- "Promote" → `isDefault=true`，所有 org 用 v2
- 出问题 → 回到 v1：再点 v1 的 "Promote"
- 中间状态：用 `POST /api/agent/prompts/{id}/share` 调 sharePct（不需要重发版本）

### 看 outcome 关联

`/api/agent/prompt-outcomes?days=30` 返回每个 prompt 版本的 `successRate` / `regressionRate` / `avgCostUsd` / `parsedRate`。

---

## 15. Webhook + Slack 接入

`/settings → Webhooks` → "+ New webhook"。

| 字段 | 测试值 |
|---|---|
| URL | Slack incoming webhook (`https://hooks.slack.com/services/...`) |
| Events | 选 `agent.approval.requested`, `agent.killswitch.activated`, `ad.policy_rejected` |
| Secret | 自动生成 `whsec_...` |

**自动 Slack 重塑**：URL 匹配 `hooks.slack.com/services/` 时，payload 自动变成 Block Kit 格式（带 severity color、按钮跳 /approvals）。其他 URL 收到原始 `{event, orgId, data, timestamp}` JSON + `X-Adex-Signature` HMAC。

### 重试管理

故意配一个会 5xx 的 endpoint：
```bash
# 用 webhook.site 拿一个会立刻关闭的 URL，或本地 nc -l 8080 不响应
```

观察：
1. 第一次发送失败 → `Webhook.failureCount++`、写一条 `WebhookDelivery` 行
2. `/webhooks?status=pending` 看到，attempts=1，nextAttemptAt 在 60s 后
3. `/api/cron/webhook-retry` 触发后 attempts++，下次 5min 后
4. 到第 5 次失败 → `abandonedAt` set → `/webhooks?status=abandoned`
5. 修好 endpoint，点 **"Requeue now"** → attempts 重置为 0，立刻重试

---

## 16. 可观测性面板

| 页面 | 看什么 |
|---|---|
| `/dashboard` | 7 天总览 + 平台饼图 |
| `/decisions` | 所有 agent 决策；按 status / severity / campaignId / since-until 过滤 |
| `/decisions/{id}` | 单条详情：完整 perceive context、每个 step 的 input/output/guardrail/platform response、可逆步骤的 rollback 按钮 |
| `/agent-stats?days=30` | 决策分布 + tool top 10 + outcome 分布 + **审批响应时间 p50/p95/max** |
| `/agent-cost?month=2026-04` | 月度 LLM 成本 + 按 prompt 版本分组 + 按日 |
| `/audit?action=advisor.apply` | 审计事件按 action / targetType 筛 |

---

## 17. 回滚 + Kill Switch

### 回滚单条决策

`/decisions/{id}` 详情页底部 "Roll back this decision":
1. 找原决策每个 reversible=true 的 step
2. 调 `tool.inverse(originalInput)` 计算逆向步骤
3. 创建一条新 Decision（mode=autonomous）执行逆操作
4. 原决策 status 改成 `rolled_back`

**测试 case**:
- pause_campaign → resume_campaign 自动反向
- adjust_daily_budget(c1, 200, previous=100) → adjust_daily_budget(c1, 100)
- adjust_targeting_geo(add: ['US']) → adjust_targeting_geo(remove: ['US'])

不可逆的步骤（如 `clone_campaign` 创建了新 campaign）会出现在 response.skipped 数组里 — 需要手动清理。

### Kill Switch

进 `/decisions` → 顶部 "Kill switch" 复选框。打开后：
- 立刻所有 cron 跳过本 org
- `runAgentLoop` 直接 return 不调 LLM
- 已存在的 PendingApproval 仍可人工 resolve
- 触发 `agent.killswitch.activated` webhook

关闭：取消勾选即可恢复。

---

## 18. 运维 + cron

### Cron 列表

| 频次 | 端点 | 用途 |
|---|---|---|
| 每小时 | `/api/cron/agent` | snapshot + drift + plan + act + verify + 自动降级 |
| 每小时 | `/api/cron/agent-expire` | 72h 过期 PendingApproval |
| 每小时 | `/api/cron/webhook-retry` | webhook 失败重试 |
| 每天 04:00 | `/api/cron/daily` | sync + digest + Budget.spent 刷新 |
| 每天 | `/api/cron/agent-retention` | 删 90d 老 ad-Report、13mo 老 campaign-Report、30d 后稀释 snapshot |
| 每周一 09:00 | `/api/cron/agent-weekly` | 周报邮件 |

全部需要 `X-Cron-Secret` header（Cloud Run 环境变量 `CRON_SECRET`）。

### 手动触发

```bash
curl -X POST https://adexads.com/api/cron/agent \
  -H "X-Cron-Secret: $CRON_SECRET"
```

### 限流测试

`/api/agent/run` 每 org 6 次/小时；超过返回 429 + Retry-After header。第 7 次应该看到。

`/api/agent/snapshot` 12 次/小时 + 1 分钟 in-process dedupe。

---

## 19. 常见问题

### "为什么 Decisions 一直空？"

按顺序排查：
1. `/agent-onboarding` 确认 `enabled=true`、`killSwitch=false`
2. `/agent-cost` 确认 `monthlyLlmSpent < monthlyLlmBudget`（满了 `llm_budget_cap` 会 block）
3. `/campaigns` 确认有至少 1 条 status ∈ {active, paused} 的 campaign（perceive 把 archived/draft 都过滤）
4. 点 "Run now" 看返回的 `errors` 数组

### "agent 决策为什么总是 noop？"

- 大概率是 `ANTHROPIC_API_KEY` 没配 → 落 pass-through 模式（log 里能看到 `'LLM not configured — agent in pass-through mode'`）
- 配了的话，可能 perceive 的 campaigns 数据太少：metrics 全 0 → fixture-05 的"低信号"场景就该是 noop

### "rollback 提示 'No reversible steps'"

原决策的 step 没有 `previous*` 字段（adjust_daily_budget 没传 previousDailyBudget 之类），inverse() 返回 null。这种情况下只能手动新发一条决策做逆操作。

### "Slack 没收到通知"

排查：
1. `/webhooks?status=pending` 有没有失败记录
2. `Webhook.events` 字段有没有列对应事件名（精确匹配，不是模糊）
3. URL 是不是 `hooks.slack.com/services/...` — 这是自动 Slack 重塑触发条件
4. `webhook.site` 收一个测试 URL 看原始 payload

### "Migration 失败怎么办"

- Cloud Run start.sh 的 migrate 失败不会阻止 server 启动（只 echo WARNING），但表结构会缺
- 看 Cloud Logging 找 `[adex] WARNING: Migration may have failed` 上下文
- 可以本地用 `tsx prisma/backfills/01_platform_links.ts` 跑回填脚本兜底
- 实在不行，回滚 Cloud Run 到上一个 revision：`gcloud run services update-traffic adex --to-revisions=PREVIOUS=100`

---

## 测试通关检查清单

跑完上面 18 节，应该已经验证了：

- [ ] 用户注册 + 多 org
- [ ] 至少 1 个广告平台 OAuth 接入
- [ ] 创建 + launch + 同步 + bulk-pause campaign
- [ ] 上传 + AI 生成 creative，关联到 ad
- [ ] Advisor 给出建议并 apply
- [ ] Agent shadow 模式跑出 10+ 决策
- [ ] approval_only 模式：1 单 + bulk 审批
- [ ] 至少 2 条 guardrail 自定义规则生效
- [ ] LLM 生成 → 人工 review → push 到平台 链路完整
- [ ] 跑完一个 2-arm 实验拿到显著性结果
- [ ] 升级到 autonomous（owner allowlist + dwell time）
- [ ] 创建 PromptVersion v2，跑 backtest，按 sharePct 灰度
- [ ] Slack webhook 收到 5+ 条不同事件
- [ ] 看到 audit / agent-stats / agent-cost 三个面板有真实数据
- [ ] 跑一次决策 rollback
- [ ] 触发 kill switch，看到 cron 被 skip
- [ ] 手动 trigger 6 个 cron 端点，全部 200

**通关后** = 可以放心给真实客户了。
