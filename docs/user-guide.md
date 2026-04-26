# Adex 用户操作指南

> 给第一次用 Adex 的人。从注册到让 AI 自动管你的广告，按顺序跟着做。看不懂的术语都标了 *星号* 在文末有解释。

> 在线地址：<https://adexads.com>

---

## 目录

- [Part 1 · 第一次上手（30 分钟）](#part-1--第一次上手)
  - [1.1 拿到邀请码](#11-拿到邀请码)
  - [1.2 注册账号](#12-注册账号)
  - [1.3 创建 / 切换 workspace](#13-创建--切换-workspace)
  - [1.4 接广告平台](#14-接广告平台)
- [Part 2 · 日常投放工作流](#part-2--日常投放工作流)
  - [2.1 创建第一条 Campaign](#21-创建第一条-campaign)
  - [2.2 准备创意素材](#22-准备创意素材)
  - [2.3 上线 + 观察数据](#23-上线--观察数据)
  - [2.4 调整 Campaign](#24-调整-campaign)
- [Part 3 · 让 AI 帮你（核心）](#part-3--让-ai-帮你)
  - [3.1 用 Advisor 拿建议](#31-用-advisor-拿建议)
  - [3.2 第一次开 Agent（shadow 模式）](#32-第一次开-agentshadow-模式)
  - [3.3 看 Agent 给的决策](#33-看-agent-给的决策)
  - [3.4 升级到审批模式](#34-升级到审批模式)
  - [3.5 配置安全规则](#35-配置安全规则)
  - [3.6 升级到完全自动](#36-升级到完全自动)
- [Part 4 · 高级玩法](#part-4--高级玩法)
  - [4.1 A/B 实验](#41-ab-实验)
  - [4.2 AI 自动生成创意](#42-ai-自动生成创意)
  - [4.3 多人协作](#43-多人协作)
  - [4.4 接 Slack 收通知](#44-接-slack-收通知)
- [Part 5 · 出问题怎么办](#part-5--出问题怎么办)
- [术语表](#术语表)

---

## Part 1 · 第一次上手

### 1.1 拿到邀请码

Adex 是邀请制，**没有码注册不了**。

**怎么拿到码？**
- 找你认识的 Adex 平台管理员要一个 INVT-XXXX-XXXX-XXXX 格式的码
- 或者管理员把 `https://adexads.com/register?code=INVT-XXXX-XXXX-XXXX` 这种链接发给你

每个码**只能用一次**，用过就失效。如果你不小心填错搞丢了，找管理员再发一个。

### 1.2 注册账号

1. 访问 <https://adexads.com> （会自动跳到 `/login`）
2. 点 "Sign up" 或直接走管理员发给你的邀请链接
3. 邀请码自动填好（如果是从链接来的）；否则手动输入
4. 填：姓名、邮箱、密码（≥ 8 位）、再次确认密码
5. 点 "Create Account" → 自动跳到 dashboard

> 💡 **建议**：邮箱用工作邮箱（每天会 check 的那个），后面 AI 审批通知 + 周报都发到这里。

### 1.3 创建 / 切换 workspace

注册时系统给你建了一个**个人 workspace**（叫 "你的名字's workspace"）。

**workspace 概念**：每个 workspace 是一个完全独立的容器——campaign、预算、报表、平台账号、AI 决策都隔离。如果你给多个客户做投手，每个客户开一个 workspace；自己用就用默认的。

**新建 workspace**：
1. 左上角点 workspace 名字 → 弹出菜单 → "Create new"
2. 填名字、slug
3. 进新 workspace 后所有页面都是空的——你就是 owner

**切换 workspace**：左上角点名字 → 选另一个；页面会刷新。

**邀请同事进同一个 workspace**：见 [4.3 多人协作](#43-多人协作)。

### 1.4 接广告平台

Adex 不替你存广告，所有真实操作都打到平台 API。所以第一步是把账号接进来。

进 `/settings → Platform Auth`：

#### Google Ads（最常用，最复杂）

需要：
- Google Ads MCC（My Client Center）账号
- 一个 [Developer Token](https://developers.google.com/google-ads/api/docs/first-call/dev-token)（Google 审核 24-48h，必须先有）
- OAuth Client ID + Secret（从 Google Cloud Console 里建）

步骤：
1. 在 Google Cloud Console 建 OAuth 2.0 Client
   - Authorized redirect URI 填 `https://adexads.com/api/auth/google/callback`
2. 回 Adex `/settings → Platform Auth → Google Ads`
3. 填 Client ID / Client Secret / Developer Token / MCC Customer ID
4. 点 "Connect" → 跳 Google 授权页 → 同意 → 跳回
5. 看到绿色 "Connected" + 你 MCC 下属的 customer 列表

> ⚠️ **首次试用强烈建议用 [Test Account](https://developers.google.com/google-ads/api/docs/start)**，零预算、所有 API 调用真实但不会真扣钱。生产账号上手前先用 test 跑一周。

#### Meta (Facebook / Instagram) Ads

需要：
- Meta Business 账号
- Ad Account ID（`act_xxxxx`）
- System User Access Token（在 Business Settings 里建，permissions 选 ads_management + ads_read）

步骤：
1. `/settings → Platform Auth → Meta Ads`
2. 填 Ad Account ID（不带 act_ 前缀也行）+ Access Token
3. 点 Connect → 立即生效

#### TikTok Ads

需要：
- TikTok Business 账号
- Advertiser ID
- Access Token（[TikTok Marketing API](https://business-api.tiktok.com/portal) 里建）

步骤：同 Meta。

#### Amazon / LinkedIn / AppsFlyer / Adjust

类似流程，每个填 API 文档要求的字段。详见每个 platform 旁的 "?" tooltip。

> 💡 **Adex 绝不会**把你任何 token 主动转发给第三方。所有 token 加密存在 Cloud SQL，只在调用对应平台 API 时使用。

接完后回 `/dashboard` 看到 7 天合并数据 ≈ 30s 后开始填充。

---

## Part 2 · 日常投放工作流

### 2.1 创建第一条 Campaign

进 `/campaigns → "+ New Campaign"`：

| 字段 | 怎么填 |
|---|---|
| Name | 起个能在 dashboard 一眼看出来的，比如 "夏季-美国-展示-夏新品" |
| Platform | google / meta / tiktok（接了哪个平台才能选） |
| Objective | awareness（曝光） / consideration（流量） / conversion（转化） |
| Target Countries | 多选，按 ISO-3166 国家码（US / CN / JP 等） |
| Age | 默认 18-65，按你的产品调 |
| Gender | all / male / female |
| Start / End Date | 留空 = 今天起、永不结束 |
| Budget | 选 daily / lifetime + 金额 |

保存后 status = `draft`。点 **"Launch"**：

**实际发生的**：Adex 调对应平台 API 创建 campaign，**默认状态是 PAUSED**——平台不会马上开始烧钱。`/campaigns/{id}` 详情页会显示两个 badge：

- `desired: active`（你的意愿）
- `platform: paused`（平台真实状态）

这是正常的安全设计：让你可以先去平台后台手工补全 ad group / creative，再点 active。如果你的 campaign 包含完整的 ad group + ad，platform 会自动转 active。

#### 黄色横幅 = drift

如果两个 badge 颜色对不上（绿+黄），说明本地状态和平台状态不一致——可能是有人在平台后台直接改了。详情页会出黄色 "Drift detected" 横幅；管理员每小时也会自动收到 drift 通知（如果该 campaign 已开 `managedByAgent`）。

### 2.2 准备创意素材

Campaign 没素材跑不起来。三种来源：

#### A. 上传现有素材

1. `/assets → "Upload"`
2. 拖图片或视频（≤ 10MB；视频建议 mp4 / mov 1080p）
3. 上传完看到缩略图，可加 tag 方便查找
4. 大量上传：按住 shift 多选

#### B. 从 Google Drive 拉

1. `/assets → "Sync from Google Drive"`
2. 接 Drive OAuth → 选文件夹 → 自动同步进 Asset 库
3. 之后 Drive 里改名/删除会反映到这里（每天）

#### C. AI 生成

**图片**（Seedream 豆包文生图）：
1. `/seedance2`（兼用界面）
2. 选 "Generate Image"
3. Prompt 写描述：`"a young woman holding our skincare bottle, sunny beach, summer vibes, photorealistic"`
4. 选尺寸（1024x1024 等）
5. 30s-1min 出图

**视频**（Seedance2 豆包文生视频）：
1. `/seedance2 → "Generate Video"`
2. Prompt：`"15s product demo, summer fashion brand, energetic, beach setting, model walking"`
3. 1-3min 出 15s 短视频

#### 把 creative 关联到 campaign

1. `/creatives → 点 creative → "Attach to ad"`
2. 选 campaign → 自动建 ad group + ad（如果还没的话）
3. 回 `/campaigns/{id}` 看到 ad 列表多了一行

### 2.3 上线 + 观察数据

#### 同步数据

- 自动：每天凌晨 4 点跑同步 cron，刷新最近 7 天的所有指标
- 手动：`/dashboard → "Sync Data"`，立即拉一次（受平台限流，2 分钟内重复点会去重）

同步后看 dashboard：
- 7 天 trend 曲线
- 各平台花费 / ROAS 饼图
- 单条 campaign 详情走 `/campaigns/{id}` → 7 天指标曲线

#### 关键指标

| 缩写 | 中文 | 怎么解读 |
|---|---|---|
| Impressions | 展示数 | 广告被显示了多少次 |
| Clicks | 点击数 | 用户点了多少次 |
| CTR | 点击率 | clicks/impressions × 100% — < 1% 通常素材有问题 |
| Spend | 花费 | 真金白银 |
| Conversions | 转化 | 平台口径，看你的转化事件配置 |
| Revenue | 收入 | 来自平台 conversion value 或 MMP 回传 |
| ROAS | 投产比 | revenue/spend — 1 = 打平，2 = 翻倍，0.4 = 亏到姥姥家 |
| CPC | 单次点击成本 | spend/clicks |
| CPA | 单次获取成本 | spend/conversions — 比 ROAS 更稳 |

#### Budget 监控

`/budget` 看每条预算的 `spent` / `amount`：
- daily 预算：今天到现在花了多少
- lifetime 预算：总开支

**重要**：Budget.spent 数字来自 Report 同步——所以最迟会比平台后台慢 24h。如果你需要现在就刷新，点 "Refresh now"（或 `POST /api/budgets/refresh`）。

### 2.4 调整 Campaign

#### 暂停 / 恢复 / 删除

`/campaigns` 列表里每条都有按钮：
- **Pause**：暂停（reversible）
- **Resume**：恢复（reversible）
- **Delete**：永久删除（**不可逆**——会从平台 API 真删）

#### 批量操作

`/campaigns` 每条左边有勾选框：
1. 勾 5 条
2. 顶部蓝条出现 → "Pause selected" / "Resume selected" / "Archive selected"
3. Adex 一次过对所有 5 条调 platform API；返回每条单独结果，失败的会标红

#### 改预算 / Targeting

`/campaigns/{id}` 详情页 → "Edit"：改完保存，Adex 会调对应平台 API 同步过去。如果某个字段平台不允许改（比如已 launch 后改 objective），返回错误，本地不变。

---

## Part 3 · 让 AI 帮你

这是 Adex 的主打。**先不要急着开 autonomous 模式**——按下面节奏走。

### 3.1 用 Advisor 拿建议

最低门槛的 AI 用法。

1. `/advisor → "Get Advice"`
2. 等 5-10s，Claude 看完你过去 7 天数据，返回 3-6 条建议
3. 每条带 severity（颜色）+ 文字描述 + 推荐动作
4. 看到合理的，点 "Apply" → 立即生效（仅限 pause / resume，安全的动作）

**典型场景**：
- 早晨喝咖啡时打开 → 点 Apply 处理 1-2 条 → 关掉
- 不需要任何配置；不会造成意外伤害

### 3.2 第一次开 Agent（shadow 模式）

进阶——让 AI **每小时主动跑一遍**整个分析+决策循环，但**不真执行任何操作**。这是观察期。

1. 进 `/agent-onboarding`
2. 看到 "Stage 1 · Shadow"，点 **"Enable agent (starts shadow)"**
3. 立即跑一次：`/decisions → "Run now"`（不用等 cron 的整点）
4. 几秒后看到弹窗 "Created N · Skipped N"

**接下来的 7 天**：什么都不用做。Agent 每小时跑一次，把它"想做但没做"的决策写进 `/decisions`。

**每天花 1 分钟**：进 `/decisions` 翻最近的几条，看：
- AI 的 rationale（推理）合理吗？
- 它建议的 tool 选对吗？
- 如果它真做了，会不会闯祸？

**预期**：刚开始 80% 的 cycle 决策是 `noop`（无事可做），20% 是 flag/pause/budget 调整。如果完全没决策——查 [Part 5](#part-5--出问题怎么办)。

### 3.3 看 Agent 给的决策

`/decisions` 列表 + 详情：

| 看什么 | 在哪里看 |
|---|---|
| AI 推理过程 | rationale（每条决策卡上的描述文字） |
| AI 想用什么 tool | steps 数组里每一项 |
| guardrail 是否拦住 | 展开 step → guardrails 报告 |
| 完整上下文（喂给 AI 的数据） | 详情页底部 "Perceive context" |
| 24h 后的实际效果 | outcome 字段（success / regression） |

**Filter** 帮你聚焦：
- 按 status: pending / executed / failed / skipped
- 按 severity: alert（最严重）/ warning / opportunity / info
- 按 campaignId（输入完整 cuid 回车）
- 按时间范围（since / until 日期）

### 3.4 升级到审批模式

shadow 跑 7 天后（系统会 enforced），可以升级。

1. `/agent-onboarding → "Promote to approval_only"`
2. 现在 AI 决策不再 skip——而是创建 PendingApproval 等你审批
3. **每天养成习惯**：早晨进 `/approvals`，处理积压

#### 审批操作

每条审批卡片显示：
- 严重程度
- AI 的 rationale
- 它打算做什么（每个 step + input）
- 失效时间（72h 后自动 reject）

**单条**：
- "Approve & run" → 立即执行；返回结果
- "Reject" → 填可选理由，决策标 rejected，关闭

**批量**：
- 勾左边 checkbox → 顶部 "Approve selected" / "Reject selected"
- 一次最多 50 条

**邮件通知**：进 `/settings`，给自己配 `dailyReportEmail`。下次有新审批，邮件会带：rationale + steps + 直接链接进 `/approvals`。

#### 审批响应时间

`/agent-stats` 顶部"Approval response time"卡片显示你的中位数 / p95 / 最大值。
- **中位数 < 4h** = 正常工作流
- **中位数 > 24h** = 你不该开这个模式 / 该雇人 / 该升级到 autonomous

### 3.5 配置安全规则

进 `/guardrails`，**12 条内置规则始终生效**（不显示但管用）：

| 规则名 | 默认行为 |
|---|---|
| `high_risk_requires_approval` | 任何高风险 tool（adjust_bid 等）默认要审批 |
| `llm_budget_cap` | 超月度 LLM 预算就停跑 plan() |
| `cooldown` | 同一 step 4 小时内重复直接 block |
| `pause_only_with_conversions` | 24h 数据样本不够时不许 pause |
| `max_per_day` | 每个 tool 24h 内最多 20 次 |

**你可以加自定义**："+ New guardrail"：

| 想达成 | 选 rule | config 例子 |
|---|---|---|
| 任何 campaign 单日预算不超 $200 | `budget_max_daily` | `{ "max": 200 }` |
| Org 总日预算不超 $5000 | `budget_max_total_daily` | `{ "max": 5000 }` |
| 单次预算改动 ≤ ±30% | `budget_change_pct` | `{ "maxIncreasePct": 30, "maxDecreasePct": 30 }` |
| AI 只在 9-22 点（UTC）操作 | `agent_active_hours` | `{ "startHourUtc": 9, "endHourUtc": 22 }` |
| 改超过 $500 必须人工审 | `requires_approval_above_spend` | `{ "threshold": 500 }` |
| 只对开了 managedByAgent 的 campaign 操作 | `managed_only` | `{}` |

**给单条 campaign 单独配规则**：scope 选 "campaign"，scopeId 填那条 campaign 的 cuid。

> 💡 **从严不从宽**：先把所有 guardrail 设得严格，跑两周看哪些规则总是 block 合理动作，再放松。反过来损失大。

### 3.6 升级到完全自动

approval_only 跑 14 天后允许升级——但还要 owner 单独 allowlist。

#### Step 1: Owner 开 allowlist

`/agent-onboarding → Stage 3 → "Grant"` 按钮（**只有 owner 能看到这个按钮**——不是 admin、不是 member）。

#### Step 2: 升级

`/agent-onboarding → "Promote to autonomous"`：
- dwell time 满 ≥ 14 天 + allowlist 已 grant → 按钮可点
- 点击后立即生效，AI 决策直接执行（仍受 guardrail 约束）

#### 此后

- 大部分决策不再过审批（除非违反 guardrail）
- `/decisions` 里看到 mode=autonomous + status=executed 的卡片增多
- **24h 后**所有 executed 决策都会被 verify cron 标记 outcome（success / neutral / regression / false_positive）

#### 自动降级

如果连续 3 次 verified regression，系统**自动降回 approval_only**，并触发一个高优先级 webhook 通知。这是不需要你管的自我保护。

---

## Part 4 · 高级玩法

### 4.1 A/B 实验

测试两个版本哪个 CTR / CVR 更高，跑 z-test 给科学结论。

#### 准备

需要：
- 一条已 launch 的 platform campaign
- 两个候选 ad（或 ad group）的 PlatformLink ID

#### 启动

API 直接调（UI 在 Experiments 页面 "+ New experiment"）：
```bash
POST /api/agent/experiments
{
  "campaignLinkId": "<id>",
  "hypothesis": "新 headline 比旧的提升 20% CTR",
  "primaryMetric": "ctr",   // or "cvr"
  "durationHours": 168,     // 7 天
  "minSampleSize": 1000,
  "arms": [
    {"name":"control","adLinkId":"<id1>","trafficShare":0.5},
    {"name":"variant","adLinkId":"<id2>","trafficShare":0.5}
  ]
}
```

更省事——让 Agent 自己起：用 `start_experiment` tool 配 `cloneFromAdGroupLinkId`，AI 调 adapter 真的复制源 ad group 到同 campaign，自动 50/50 分流。

#### 看结果

`/experiments` 列表 → 点进单条：
- 进度条（已跑 X/168 小时）
- 两个 arm 当前 metrics
- 跑完后 **"Conclude now"** 按钮可点 → 跑两比例 z-test → 显示 winner + p-value + 95% CI

显著差异需要：
- p < 0.05（z-test 默认阈值）
- 两 arm 样本各 ≥ minSampleSize（默认 1000）

不显著就是不显著，**不要为了拿结论而硬跑**。

### 4.2 AI 自动生成创意

Agent 决策可能包含 `generate_creative_variant` step——AI 觉得当前素材 CTR 太低，主动让 Seedream / Seedance 生新版本。

#### 流程

1. AI 提议 → 创建 Creative，`reviewStatus='pending'`
2. 触发 `creative.review_requested` webhook（Slack 收到通知）
3. 你进 `/creatives/review?status=pending` 查看
4. 看下生成的图/视频，决定 Approve 或 Reject
5. Approve 后，AI 后续可以提议 `push_creative_to_platform` step 把素材真的传到平台
6. 平台审核通过后才会展示给真实用户

#### 配置 review 流程的责任人

谁有权 approve？
- 你自己（owner / admin） → 审审你自己 org 的 creative
- 给同事 admin 角色 → 他们也能审

> 💡 **生成质量取决于 prompt**。Agent 用的 prompt 在源码里——如果你看到很多 reject，可以在 `/prompts` 创建 v2 改进它。

### 4.3 多人协作

#### 邀请同事进 workspace

1. `/settings → Members → "Invite"`
2. 填邮箱 + 角色：
   - **owner**：所有权限，可以转移所有权
   - **admin**：除了删 workspace 和管成员、其他全权
   - **member**：只读 + 自己创建的内容
3. 系统发邀请邮件，对方点链接接受

#### 角色对照

| 操作 | owner | admin | member |
|---|---|---|---|
| 看 dashboard | ✅ | ✅ | ✅ |
| 建 / 改 / 删 campaign | ✅ | ✅ | ✅ |
| 改 platform auth | ✅ | ✅ | ❌ |
| 邀请成员 | ✅ | ✅ | ❌ |
| 改 agent 配置 | ✅ | ✅ | ❌ |
| Approve / Reject 审批 | ✅ | ✅ | ❌ |
| 改 guardrail | ✅ | ✅ | ❌ |
| Grant autonomous allowlist | ✅ | ❌ | ❌ |
| 删 workspace / 转所有权 | ✅ | ❌ | ❌ |

### 4.4 接 Slack 收通知

每次 Agent 提了审批 / 触发 Kill Switch / 遇到平台拒绝创意时，立即知道。

#### Step 1: 在 Slack 端建 Incoming Webhook

1. <https://api.slack.com/apps> → Create App → From scratch
2. Incoming Webhooks → Activate
3. Add New Webhook to Workspace → 选频道（建议建一个 `#adex-alerts`）
4. 复制 URL（`https://hooks.slack.com/services/T.../B.../xxxx`）

#### Step 2: 在 Adex 配 Webhook

1. `/settings → Webhooks → "+ New"`
2. URL 粘贴上面的 Slack URL
3. Events 至少选：
   - `agent.approval.requested` — 有新审批
   - `agent.killswitch.activated` — Kill Switch 触发
   - `ad.policy_rejected` — 平台拒绝你的 ad
4. Save → 立即测试一次

#### 自动 Slack 格式化

Adex 检测到 URL 是 `hooks.slack.com/services/...` 时，**自动**把 payload 转成 Slack Block Kit 格式（带 severity 颜色 + 一键打开 Adex 按钮）。其他 URL 仍是原始 JSON。

---

## Part 5 · 出问题怎么办

### 我点 "Run now" 但 Decisions 一直空

按顺序排查：

1. `/agent-onboarding` 确认 `enabled=true`、`Kill switch=off`
2. `/agent-cost` 看本月 LLM spend 是否超 budget cap → 超了就改高
3. `/campaigns` 确认有至少 1 条 status ∈ {active, paused} 的 campaign（archived/draft 会被过滤）
4. 仍然没有 → 看 `/decisions` 顶部 "Run now" 按钮返回的 `errors` 数组

### 我点 Apply / Approve 后报 "PlatformError"

平台 API 拒绝了。详情页底部 platformResponse 有原文。常见：
- **rate_limit**：超了平台限流，等 1 分钟重试
- **auth_expired**：去 `/settings` 重连这个平台
- **invalid_argument**：动作本身平台不允许（比如 launch 一个没 ad 的 campaign）
- **not_found**：本地以为有，但平台已经被人删了——drift detection 会处理

### 我看到一条决策不对劲，想撤销

`/decisions/{id}` → 详情页底部 "Roll back this decision"：
1. AI 确认每个 step 是否可逆
2. 创建一条新决策做反向操作（直接执行）
3. 原决策标 rolled_back

不可逆动作（clone_campaign 等）会列在 response.skipped 数组里，需要手动清理。

### 我担心 AI 失控

立即进 `/decisions` → 顶部勾 **"Kill switch"** → 填理由。
- 所有 cron 立即跳过你的 org
- runAgentLoop 立即 return 不调 LLM
- 已挂起的审批仍可手动 resolve
- 关掉勾 → 立即恢复

### 我没收到 Slack 通知

1. `/webhooks?status=pending` 看是否有失败记录
2. 失败 → 点详情看 lastError + statusCode
3. 修好后 → `/webhooks?status=abandoned` → 点 "Requeue now" 强制重试
4. URL 拼错或者频道删了 → 在 `/settings → Webhooks` 编辑或重建

### 平台后台改了状态，Adex 没反应

每小时一次的 snapshot cron 会 detect drift，managedByAgent=true 的 campaign 会自动开 PendingApproval。如果你不想等：

1. `/decisions → "Snapshot now"` 立即拉一次
2. 进 `/approvals` 看是否多了 drift-flag 卡片
3. 进 `/campaigns/{id}` 看头部黄色横幅

### 我想停掉自动同步

`/agent-onboarding` 关 `enabled` → 所有 cron 跳过本 org。但 daily 同步（拉最新 7 天数据）不归 agent 管，那个永远会跑（除非你完全删 platformAuth）。

### 出错联系谁

- **平台 bug**：在 GitHub 提 issue（如果你能访问 repo）
- **管理员配错**：找你 org 的 owner
- **平台 API 那边的事**：看错误码，对应去 Google Ads / Meta 后台查
- **想升级方案 / 加新平台**：联系平台管理员

---

## 术语表

| 词 | 含义 |
|---|---|
| **workspace / org** | 完全隔离的容器：campaign、报表、平台账号、AI 决策都按这个分组。一个用户可以加入多个 workspace。 |
| **owner / admin / member** | workspace 内的角色，权限见 [4.3](#43-多人协作)。 |
| **platform admin** | 完全独立于 workspace 的平台级管理员，可以管邀请码 + 提升其他人为 platform admin。`/admin` 系列页面只对他们可见。 |
| **Campaign** | 一条广告投放计划，对应平台上的同名概念。 |
| **Ad Group** | Campaign 内的投放单元，按受众/创意细分。 |
| **Ad** | 实际展示给用户的那个广告（图/文/视频组合）。 |
| **Creative** | 素材（图/视频）。一个 creative 可以挂到多个 ad 上。 |
| **PlatformLink** | "本地实体 ↔ 平台实体" 的映射表。一条本地 Campaign 在 Google 上对应 PlatformLink(entityType='campaign', platformEntityId=Google 那边的 ID)。 |
| **Agent** | 每小时自动跑的 AI 决策循环。三种模式：shadow / approval_only / autonomous。 |
| **Decision** | Agent 一次推理的产物。包含 rationale + 多个 step。 |
| **Step** | 一个 tool 调用 + 它的 input。例如 `pause_campaign(campaignId=xxx)`。 |
| **Tool** | Agent 可调用的"动作"，共 17 个。pause / resume / 改预算 / 起实验 / 生创意 等。 |
| **Guardrail** | 每个 step 执行前必须通过的硬规则。12 类内置 + 你可加任意条。 |
| **Outcome** | 24h 后对决策真实效果的标记：success / neutral / regression / false_positive。 |
| **Drift** | 本地 Campaign.desiredStatus 和平台真实 status 不一致。snapshot 每小时检测一次。 |
| **Shadow / Approval / Autonomous** | Agent 三种激进度：观察→人审→自动。必须按顺序升级。 |
| **Kill Switch** | 一键停所有 agent 行为，cron 跳过本 org。 |
| **ROAS** | Return On Ad Spend = revenue / spend。1 = 打平，越高越好。 |
| **CTR / CVR** | 点击率 / 转化率。 |
| **CPA** | Cost Per Acquisition = spend / conversions。 |
| **Backtest** | 用历史数据重放 Prompt v2，对比 v1 的决策差异。`/prompts → 单条 → "Backtest 7d"`。 |

---

**完成本指南后**：你应该能给小团队跑一个完整投放→AI 自动调优的工作流。下一步看 [features.md](./features.md) 了解平台理念，或 [testing-guide.md](./testing-guide.md) 做更系统的回归验证。
