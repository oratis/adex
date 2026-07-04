# Adex 全面重构设计：Cuddler-First 增长操作系统（Growth OS）

> 版本：v1 · 2026-07-04
> 输入材料：Adex 现有代码与 `docs/agent/01–09` 系列 · HakkoAI 工具箱能力盘点（`/Users/oratis/Projects/Claude/HakkoAI`）· Cuddler GTM 全套文档（`/Users/oratis/Projects/Claude/Cuddler/docs/gtm_strategy.md` 等）
> 定位：本文承接 `docs/agent/` 系列（Phase 10–17 已全部落地），规划 **Phase 18–21**。不推翻现有 Agent 内核，在其上扩展。

---

## 0. 一页摘要（TL;DR）

**核心判断（v2 修正）：Cuddler 初期即会付费投放，首期预算 $5,000。** 这覆盖了 Cuddler GTM 文档里"付费暂缓至第 7 位"的原始排序（`gtm_strategy.md §7`）——是客户对自身成文策略的一次主动调整。$5K 不是放量预算，是**买决策数据的信息预算**：在 20 天内花完、换回"付费流量质量 vs 有机 beachhead"的可信读数。因此 Adex 的付费能力**不能拖到 9 月**，必须在 Cuddler 上线后的 pilot 窗口（约 8 月）就位；否则第一个客户的第一笔投放要么等 Adex、要么绕开 Adex 手工投（两者都是产品失败）。这笔 pilot 的六个关键决策经过正反方辩论逐题裁决，落地为 **[01-5k-pilot-plan.md](01-5k-pilot-plan.md)**。

**重构方向：从"投放 Agent 平台"扩展为"增长操作系统"**，分三层：

1. **增长数据底座**（7 月，pilot 前置）：接入 Cuddler 真实归因栈（GA4 + RevenueCat + App Store Connect / Google Play），建立 install → 激活 → D1/D7 → 订阅 → LTV 全漏斗与分渠道 cohort。这是 pilot 能否产出可信读数的**度量脊柱**——尤其是 web 漏斗（Meta/TikTok → cuddler.ai 注册订阅）走 GA4/Stripe 确定性归因，绕开 SKAN，是 pilot 的主测量臂。
2. **渠道执行层**（8 月，pilot 使能）：Meta/TikTok 的 app-install + web-conversion 最小创建链路 in-Adex（dogfooding + audit + 防状态漂移）+ 预算守护引擎 + ASA 手工投的度量回灌。有机渠道（KOL 归因、评论舆情、K-factor）并行。付费就绪不再是"9 月新阶段"，而是 pilot 的组成部分。
3. **Agent 决策层升级**（9–10 月，放量期）：现有 perceive→plan→act→verify 循环喂入全漏斗数据，新增跨渠道预算工具，并把 pilot 纪律（分层 eCAC 上限、真实付费信号才准 scale、SKAN 延迟感知、$5K 硬顶）编码为 **guardrail**——这是 Adex 现有安全体系与 Cuddler 需求的最佳契合点。

**HakkoAI 的作用**：它有一整套生产级增长基础设施（7 数据源 KPI 管道、LLM 反馈分类、KOL 归因、订阅 cohort/LTV 分析）。我们**移植逻辑（KPI 口径、SQL 配方、LLM prompt、数据模型），不移植运行时**（Python/DuckDB/D1/飞书栈不进 Adex，全部落 Next.js + Postgres）。

**排期（v2 重排，付费能力前移）**：P18（7 月，3 周）数据底座 + web 漏斗测量臂 → P19（8 月，3 周）pilot 使能（Meta/TikTok 创建链路 + 预算守护 + ASA 度量 + 有机归因）→ **$5K pilot 跑于 P18+P19 交付物之上（约 8 月中–9 月中）** → P20（9 月，3 周）ASA adapter + 完整 app-install 自动化 + scene 素材管线 → P21（10 月，3 周）Growth Agent + 放量纪律。

---

## 1. 背景与三方现状

### 1.1 Adex 现状（截至 main@714058a）

Phase 10–17 已全部落地，能力远超早期文档：

| 层 | 已有能力 | 代码位置 |
|---|---|---|
| 平台执行 | Google/Meta/TikTok 全 CRUD adapter，Amazon/LinkedIn 只读；PlatformLink 双向同步 + drift 检测；多广告账号（PlatformAccount） | `src/lib/platforms/*-adapter.ts`, `registry.ts` |
| 数据 | Report 表 account/campaign/adgroup/ad 四级粒度；AppsFlyer/Adjust MMP 拉取；CampaignSnapshot | `src/lib/sync/`, `prisma/schema.prisma` |
| 创意 | Seedream 文生图 + Seedance2 文生视频 + Claude 文案；review→push 平台链路 | `src/lib/platforms/seedream.ts`, `seedance2.ts` |
| Agent | 每小时 perceive→plan→act→verify；18 个工具；12 类 guardrail；shadow/approval_only/autonomous 三模式；Decision 回看；实验框架；Prompt 版本化 | `src/lib/agent/` |
| 协作 | 多租户 org、审批队列、Slack 通知、审计日志、webhook | `src/app/api/`, `src/lib/` |

**关键缺口（相对 Cuddler 需求）**：

- `Campaign.objective` 只有 awareness/consideration/conversion，**没有 app_install 类型**；无 PromotedApp（bundle id / store id / deep link）概念。
- **没有 Apple Search Ads**——Cuddler 是 iOS-first，ASA 是 iOS 获客第一渠道且是自归因平台（不受 SKAN 模糊化影响）。
- 归因只对接 AppsFlyer/Adjust，而 **Cuddler 的归因栈是 GA4 + RevenueCat + Universal Links，没有 MMP**。
- 漏斗只到 conversions/installs/revenue 字段，**没有 D1/D7 留存、订阅转化、cohort LTV、K-factor**——而这些正是 Cuddler 付费开闸的 gate 指标。
- 只覆盖付费渠道，**没有有机渠道（KOL/社区/ASO/referral）的度量与归因**——那是 Cuddler 前 60 天的全部增长来源。

### 1.2 Cuddler GTM 摘要（服务对象）

来源：`Cuddler/docs/gtm_strategy.md`（主文档）、`unit_economics.md`、`prd_mobile_app.md`、`release_schedule.md`、`retention_d1_benchmark.md`。

- **产品**：AI 角色扮演 → 电影化视频（"Playable Stories"）。iOS-first（2026-07 提审上线），Web 辅助，Android 休眠。免费 + Lite $4.99 / Pro $9.90 / Ultra $19.90 订阅 + credits。
- **单位经济现实**：文字聊天毛利 65–98%，但**视频生成每条亏 $0.5–1.0**（成本 $0.70–1.25，售价折合 $0.15–0.30）。重定价（60–90 credits/条 + 分层日上限）落地前**明确禁止开付费投放**。
- **渠道优先级**（GTM §7）：① UGC 自传播（水印+深链外发 TikTok/Reels/X）② RP 社区种草 ③ ASO ④ SEO ⑤ KOL 种子（10–20 个中腰部创作者送 Ultra）⑥ 邀请裂变 ⑦ **付费广告——暂缓，LTV>3×CAC 验证后才开**。
- **90 天节奏（原文档）**：P2（1–30 天）iOS 上线 + 社区种草 → P3（31–60 天）有机增长 + feed 优化 → P4（61–90 天）$5–10K 付费试投 → Q4 放量至 $10–50K/天。**v2 修正：客户决定把首笔 $5K 付费试投前移到上线后的 pilot 窗口（约 8 月），与有机增长并行而非其后**，节奏调整详见 [01-5k-pilot-plan.md](01-5k-pilot-plan.md)。
- **North Star**：每周被外部分享的 cinematic 创作数。护栏指标：装机 ≥10K、D1 ≥30–35%、D7 ≥15–18%、订阅转化 ≥2%、K-factor >0.1。
- **归因栈**：GA4（事件已埋：`auth.signup_completed`、`chat.started`、`subscription.activated`、`scene.generated`、`paywall.viewed` 等 8 个）+ RevenueCat（订阅生命周期 webhook）+ Universal Links 深链。`scene.shared` 与深链→install 归因**尚未上线**（依赖其自身 P0：分享水印 + APPLE_TEAM_ID）。

### 1.3 HakkoAI 可移植资产（能力来源）

HakkoAI 工具箱是一套生产运行 8+ 个月的增长基础设施（服务 AI 陪伴应用双品牌），与 Adex 的目标域高度同构：

| HakkoAI 模块 | 能力 | 对 Adex 的价值 | 源路径 |
|---|---|---|---|
| **data_agent** | 7 数据源（ByteHouse/Adjust/ASC/Google Play/Google Ads/TikTok Ads/飞书）→ DuckDB 转换 → KPI Canon → 日报/周报/月报 + 实时看板；新版本 cohort 对比评估 | KPI 口径定义（DAU/留存/订阅 cohort 的 SQL 配方）、connector 模式、周报模板 | `HakkoAI/data_agent/docs/CANONICAL_KPI_SPECS.md`, `transforms/sql/` |
| **Feedback_agent** | 6 渠道反馈（NPS/邮件/Discord/App Store RSS/Google Play）→ LLM 分类（情感/23 主题/P0–P3 优先级）→ 月度报告 | 评论/舆情监控的完整 prompt 与 schema，App Store RSS 是公开接口可直接用 | `HakkoAI/Feedback_agent/scripts/feedback_llm_classify.py`（SYSTEM_PROMPT L42–150） |
| **hakko-kol-agent** | 创作者合作全生命周期 + YouTube 指标同步 + **自然注册增量归因** + 单创作者 CPM/CPA | KOL 渠道数据模型与归因方法论，直接对应 Cuddler 的 KOL 种子渠道 | `HakkoAI/hakko-kol-agent/docs/DATA_CANON.md` |
| **Subscribe_Analysis** | Stripe/Apple/Google 三源订阅聚合 → MRR/ARR/ARPU、trial→paid 漏斗、churn/cohort、实时 RTDN | 订阅 cohort → LTV 的计算配方（Cuddler 的 LTV gate 就是这套算法） | `HakkoAI/Subscribe_Analysis/METRICS.md` |
| **monthly_review** | 云账单审计 + 22 平台竞品定价基准 | 月度增长复盘 SOP 模板 | `HakkoAI/monthly_review/HOWTO.md` |

**移植原则（决策记录）**：只移植**逻辑**（KPI 口径、SQL 配方、LLM prompt、表结构、归因方法），不移植**运行时**。理由：
1. Adex 是单体 Next.js + Cloud SQL + GCS（AGENTS.md Persistence-First 规则），引入 Python/DuckDB/Cloudflare D1/飞书第二技术栈会让单工程师团队运维成本翻倍；
2. Adex 已有等价基础设施：cron 体系（`src/app/api/cron/` + Cloud Scheduler）替代 GitHub Actions 定时任务，`src/lib/llm.ts` 替代 Volcengine Ark 调用，Slack 替代飞书通知，Postgres 替代 D1/DuckDB；
3. HakkoAI 代码评审暴露的 P0 安全债（支付回调无鉴权、无幂等）提醒我们：**照抄代码会连债一起抄**，重写为 TS 时按 Adex 现有安全模式（`cron-auth.ts`、`slack-signature.ts` 的 HMAC 校验）落地。

---

## 2. 目标与非目标

### 2.1 目标

- **G1（首要）**：Cuddler 从 7 月上线日起，在 Adex 内能看到分渠道全漏斗（install → 激活 → D1/D7 → 订阅 → LTV），替代手工拼表。**Cuddler 是 Adex 的第一个真实客户（design partner），一切排期以其 GTM 里程碑为准。**
- **G2**：8 月起有机渠道（KOL/评论/ASO/裂变）可度量、可归因，支撑 Cuddler 的"压 CAC"阶段。
- **G3（前移）**：Cuddler 上线后的 pilot 窗口（约 8 月）具备支撑 $5K 试投的**最小付费闭环**——web 漏斗测量臂（GA4/Stripe 确定性归因）+ Meta/TikTok 应用安装/网页转化创建链路 + ASA 手工投度量回灌 + 预算守护。完整能力（ASA adapter、Google App Campaigns、scene 素材管线）在 P20 补齐。裁决细节见 [01-5k-pilot-plan.md](01-5k-pilot-plan.md)。
- **G4**：9–10 月放量期，Agent 决策层覆盖全漏斗：跨渠道预算再分配、素材疲劳轮换、CAC/LTV 异常告警；pilot 纪律（分层 eCAC 上限、真实付费信号才准 scale、$5K 硬顶）以 guardrail 形式强制执行。
- **G5**：所有新能力保持多租户通用性——Cuddler 特化只体现为该 org 的配置数据，不硬编码。Cuddler 是第一个客户，不是唯一客户。

### 2.2 非目标（继承并扩展 `01-vision.md` 的 Out of Scope）

- ❌ **不做 MMP / MTA**：Adex 只做 UTM/深链 first-touch + 平台自报 + SKAN 汇总的"轻归因"，不与 AppsFlyer/Adjust 竞争。Cuddler 未来若接 MMP，Adex 现有 connector 直接受益。
- ❌ **不替代 GA4**：GA4 仍是 Cuddler 的产品分析事实来源；Adex 只拉取增长相关的聚合与关键事件，不做全量事件仓库。
- ❌ **不做内容运营执行**：TikTok 官号发帖、社区回帖、KOL 沟通是人的工作；Adex 负责度量、归因与提醒（`flag_for_review` 类建议工具），不自动发内容。
- ❌ **不做 Cuddler 侧工程**：分享水印、APPLE_TEAM_ID 深链、GA4 补埋点属于 Cuddler 仓库的 P0（见 §9 契约），Adex 不越界代做。
- ❌ **不重写 Agent 内核**：perceive/plan/act/verify、guardrail 引擎、审批队列、实验框架原样复用，只扩展数据源、工具与规则。

---

## 3. 总体架构：三层重构

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3 · Agent 决策层（复用现有 loop，扩展）                      │
│  perceive: 广告指标 + 全漏斗指标 + cohort/LTV + 素材疲劳 + 舆情      │
│  plan:     现有 18 工具 + 5 个增长工具（跨渠道预算/ASA 关键词/素材）   │
│  guardrail: 现有 12 类 + 4 类增长纪律（LTV gate / CAC 上限 / SKAN   │
│             延迟感知 / 试投预算硬顶）                               │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2 · 渠道执行层                                             │
│  付费: google/meta/tiktok(+app_install) · apple_search_ads(新)    │
│  有机: KOL(CreatorPartnership) · 评论/ASO 监控 · referral/K-factor │
│  素材: Seedream/Seedance2(已有) + Cuddler scene 导入 → 变体 → 实验  │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1 · 增长数据底座                                           │
│  connectors: ga4 · revenuecat · app_store_connect · google_play  │
│              (+已有 google/meta/tiktok/amazon/linkedin/mmp)       │
│  模型: ConversionEvent · CohortSnapshot · GrowthMetric ·          │
│        PromotedApp · CreatorPartnership/Post · AppReview          │
│  引擎: 漏斗聚合 · cohort/LTV 计算(cron) · KPI Canon(单一口径定义)    │
└─────────────────────────────────────────────────────────────────┘
```

数据流（以 Cuddler 为例）：

```
GA4 Data API ──┐                       ┌→ /growth 看板（漏斗/cohort/渠道）
RevenueCat ────┤  cron/growth-sync     ├→ Agent perceive()（P21）
ASC/Play API ──┼→ ConversionEvent ──→  ├→ 周增长报告（Slack + 邮件）
深链/UTM 回传 ──┘  → CohortSnapshot     └→ guardrail 评估（LTV gate）
广告平台 API ──→ Report（已有，不动）
App Store RSS ─→ AppReview（LLM 分类）
KOL 发帖数据 ──→ CreatorPost → 自然增量归因
```

---

## 4. 数据模型改造（Prisma）

> 遵循 `.claude/rules/schema.md`：每步一个迁移，禁止改历史迁移。以下为增量，不动现有表。

### 4.1 新增模型

```prisma
// 被推广的 App（Cuddler iOS = 第一行数据）
model PromotedApp {
  id             String  @id @default(cuid())
  orgId          String
  name           String                    // "Cuddler iOS"
  platform       String                    // ios | android | web
  bundleId       String?                   // com.cuddler.main
  storeId        String?                   // App Store Connect ID: 6785787387
  deepLinkDomain String?                   // cuddler.ai
  skanEnabled    Boolean @default(true)
  extra          String?                   // JSON: ASA org id, Play package…
  @@unique([orgId, platform, bundleId])
}

// 归一化转化事件（来自 GA4 / RevenueCat / 深链回传 / 未来 MMP）
model ConversionEvent {
  id           String   @id @default(cuid())
  orgId        String
  appId        String?                     // → PromotedApp
  source       String                      // ga4 | revenuecat | deeplink | adjust
  eventName    String                      // install | signup | first_chat |
                                           // scene_generated | trial_start |
                                           // subscription_activated | renewal | churn
  occurredAt   DateTime
  userKey      String?                     // GA4 pseudo id / RC app_user_id（假名化）
  utmSource    String?
  utmCampaign  String?
  channel      String?                     // paid_asa | paid_meta | kol | organic | referral…（归一后）
  country      String?
  revenue      Float    @default(0)        // RC 净收入（订阅事件）
  raw          String?                     // JSON
  @@unique([orgId, source, eventName, userKey, occurredAt]) // 幂等去重
  @@index([orgId, eventName, occurredAt])
  @@index([orgId, channel, occurredAt])
}

// 按获客日 × 渠道的 cohort 快照（cron 每日重算滚动 60 天）
model CohortSnapshot {
  id           String   @id @default(cuid())
  orgId        String
  appId        String?
  cohortDate   DateTime                    // 获客日
  channel      String                      // 同 ConversionEvent.channel
  computedAt   DateTime @default(now())
  installs     Int      @default(0)
  activated    Int      @default(0)        // first_chat 完成（Cuddler 激活定义）
  d1Retained   Int      @default(0)
  d7Retained   Int      @default(0)
  trials       Int      @default(0)
  subscribers  Int      @default(0)
  revenueToDate Float   @default(0)
  ltvEstimate  Float    @default(0)        // 配方移植自 Subscribe_Analysis/METRICS.md
  cac          Float?                      // 分渠道 spend / installs（付费渠道）
  @@unique([orgId, appId, cohortDate, channel])
  @@index([orgId, cohortDate])
}

// 通用增长指标（非 cohort 型：K-factor、周分享数、ASO 排名等）
model GrowthMetric {
  id       String   @id @default(cuid())
  orgId    String
  date     DateTime
  metric   String                          // k_factor | weekly_scene_shares |
                                           // aso_keyword_rank | store_conversion_rate…
  channel  String?
  value    Float
  dims     String?                         // JSON 附加维度
  @@unique([orgId, date, metric, channel])
}

// KOL / 创作者合作（模型与归因方法移植自 hakko-kol-agent）
model CreatorPartnership {
  id          String   @id @default(cuid())
  orgId       String
  name        String                       // 创作者名
  platform    String                       // tiktok | youtube | discord | reddit | x
  handle      String?
  status      String   @default("negotiating") // negotiating|agreed|published|settled|dropped
  costUsd     Float    @default(0)         // 现金 + 权益折算（Cuddler: 送 Ultra 也计价）
  contractNote String?
  posts       CreatorPost[]
  @@index([orgId, status])
}

model CreatorPost {
  id            String   @id @default(cuid())
  partnershipId String
  url           String
  publishedAt   DateTime?
  views         Int      @default(0)
  likes         Int      @default(0)
  comments      Int      @default(0)
  // 自然增量归因：发布后 72h 分渠道注册 vs 前 7 天基线（HakkoAI 方法论）
  baselineInstalls  Float @default(0)
  upliftInstalls    Float @default(0)
  effectiveCpi      Float?
  lastSyncedAt  DateTime?
  partnership   CreatorPartnership @relation(fields: [partnershipId], references: [id], onDelete: Cascade)
}

// 应用商店评论 + LLM 分类（prompt 移植自 Feedback_agent）
model AppReview {
  id          String   @id                  // source:review_id 哈希，天然幂等
  orgId       String
  appId       String?
  source      String                        // app_store | google_play
  country     String?
  rating      Int?
  title       String?
  body        String?
  reviewedAt  DateTime
  sentiment   String?                       // positive|neutral|negative|mixed
  topics      String?                       // JSON array（复用 23 主题分类法，扩广告相关标签）
  priority    String?                       // P0–P3
  @@index([orgId, sentiment, reviewedAt])
}
```

### 4.2 现有模型扩展

| 模型 | 变更 | 说明 |
|---|---|---|
| `Campaign` | `objective` 增加合法值 `app_install`；新增 `promotedAppId String?` | launch 时 adapter 据此走 App Campaign / App Promotion / ASA 路径 |
| `PlatformAuth.platform` | 注释扩展合法值：`apple_search_ads`、`ga4`、`revenuecat`、`app_store_connect`、`google_play` | 复用现有 OAuth/API-key 存储与 Settings UI，数据源与广告平台同一套接入体验 |
| `Report` | 不改结构 | ASA 花费数据写 Report（它是广告平台）；GA4/RC 走 ConversionEvent（它们是转化源）。两边在 CohortSnapshot 汇合计算 CAC/ROAS |
| `Creative` | 新增 `origin String? // generated | uploaded | imported_scene` 与 `sourceRef String?`（Cuddler scene id/URL） | scene 导入素材可溯源、可按 origin 分析素材胜率 |
| `AgentConfig` | `extra` JSON 内加 growth 配置段（gate 阈值、CAC 上限、试投预算顶） | 避免加列，P21 定型后再考虑正式字段 |

### 4.3 KPI Canon（单一口径文件）

移植 HakkoAI `CANONICAL_KPI_SPECS.md` 的做法：新建 `src/lib/growth/kpi-canon.ts`，每个指标一个纯函数 + JSDoc 写清口径（分子/分母/时区/去重规则），UI、报告、Agent perceive 全部只从这里取数。**指标口径分歧是 HakkoAI 用血泪换来的教训（strict/wide DAU 双口径事故），Adex 从第一天就单点定义。**

核心口径（与 Cuddler `analytics_canon.md` 对齐）：
- `install`：GA4 first_open（iOS）；`activation`：`chat.started` 首次完成
- `D1/D7 留存`：获客日历日 +1/+7 的回访（GA4 口径，非滚动窗口）
- `LTV(t)`：cohort 累计 RevenueCat 净收入 / cohort installs，`ltvEstimate` 用衰减外推（配方照搬 Subscribe_Analysis）
- `CAC`：渠道 spend（Report）/ 渠道 installs（ConversionEvent），KOL 渠道用 `costUsd / upliftInstalls`
- `K-factor`：深链装机 / 总活跃（Cuddler 深链上线前标记为 `estimated`）

---

## 5. 平台接入层改造

### 5.1 新增 connector / adapter

| 名称 | 类型 | 用途 | 要点 |
|---|---|---|---|
| `apple-search-ads.ts` + `asa-adapter.ts` | **广告平台（读写）** | Cuddler iOS 第一付费渠道 | OAuth2 (Search Ads API v5)；campaign/adgroup/keyword CRUD + 报表。ASA 是自归因平台，装机数可信，不受 SKAN 模糊化影响——**这是 iOS-first 客户最重要的新 adapter** |
| `ga4.ts` | 数据源（只读） | 漏斗事件与留存 | GA4 Data API（runReport）拉日粒度事件 × utm 维度；注意配额（每属性每日 token 限制），只拉增长必需的 8 个事件 |
| `revenuecat.ts` | 数据源（只读 + webhook） | 订阅生命周期与收入 | 两条路：REST API 日拉 + `POST /api/ingest/revenuecat` 接收 webhook 转发（实时试用/订阅/续费/退订）。webhook 用共享密钥 HMAC 校验（复用 `slack-signature.ts` 模式） |
| `app-store-connect.ts` | 数据源（只读） | 商店转化率、装机、评论 | JWT (.p8) 认证；Sales Reports + Analytics API。**HakkoAI 曾把 .p8 泄漏进 git——密钥只进 Secret Manager（复用 `scripts/migrate-secrets-to-sm.sh` 体系）** |
| `google-play.ts` | 数据源（只读） | Android 备用（Cuddler Android 休眠，低优先） | P20 末视 Cuddler Android 复活情况决定 |
| `app-store-rss.ts` | 数据源（公开） | 评论抓取（无需授权，20 国 RSS） | 直接移植 Feedback_agent 的抓取列表与去重逻辑 |

`registry.ts` 改造：`ADAPTABLE_PLATFORMS` 加 `apple_search_ads`；新增 `DATA_SOURCE_PLATFORMS = ['ga4','revenuecat','app_store_connect','google_play','appsflyer','adjust']` 分类，`getConnector()` 与 `getAdapter()` 并列——广告平台可读写，数据源只读，类型层面防止 Agent 对数据源调用写操作。

### 5.2 现有 adapter 扩展（app_install 支持）

| Adapter | 变更 |
|---|---|
| `google-adapter.ts` | 支持 App Campaign（`MULTI_CHANNEL` + AppCampaignSetting，含 bundle id）；报表加 SKAN/installs 列 |
| `meta-adapter.ts` | `OUTCOME_APP_PROMOTION` objective + promoted_object（app id + store url）；SKAdNetwork 报表字段（现有代码已解析 `mobile_app_install` action，补 campaign 创建侧） |
| `tiktok-adapter.ts` | App Promotion objective + TikTok App ID 注册引导；SKAN 报表 |

**SKAN 约束写进 adapter 文档注释**：iOS 上 Meta/TikTok 的装机归因有 24–72h 延迟且 campaign 数量受 SKAN ID 上限约束（Meta 每 app 建议 ≤9 个 iOS campaign）。launch 校验器在超限时直接拒绝并提示。

### 5.3 Ingest API（Cuddler → Adex 推送面）

```
POST /api/ingest/events        批量事件（备用通道：GA4 Measurement-Protocol 风格）
POST /api/ingest/revenuecat    RevenueCat webhook 转发
POST /api/ingest/scenes        scene 素材元数据推送（视频 URL + prompt + 角色标签）
```

鉴权：org 级 API key（新表沿用 `CronSecret` 的哈希存储模式）+ 请求体 HMAC 签名 + 时间戳防重放 + `rate-limit.ts` 限流。**这是对 HakkoAI 支付回调无鉴权 P0 事故的直接规避。**

---

## 6. 创意管线：Scene-as-Creative

Cuddler 的增长飞轮核心资产是用户生成的 cinematic scene（Seedance 1.5 产的 5s 竖屏视频）——它们天然就是最好的广告素材（真实 UGC、平台原生格式）。Adex 已有创意库 + 变体生成 + 实验框架，缺的只是导入与规格化：

1. **导入**：`POST /api/ingest/scenes`（Cuddler 侧在 scene 公开分享时推送）+ `cron/creative-sync` 定期拉高分享 scene 兜底。视频落 GCS（`storage.ts`），Creative 行 `origin=imported_scene`。
2. **打标**：复用 `llm.ts` 对 scene prompt/画面描述打标签（角色类型/情绪/风格/语言），供素材检索与胜率分析。
3. **规格化**：校验各平台素材规格（时长/分辨率/比例——ASA 无视频素材概念、TikTok ≥5s、Meta Reels 9:16），不合规仅标记 `needsTranscode`，转码本期不做（Cuddler 出片已是 9:16 竖屏，天然适配 TikTok/Reels）。
4. **合规与授权**：**导入素材必须过现有 creatives/review 人工审核后才能推平台**（沿用 P15 review 流程）。涉及第三方 IP 的角色 scene（Cuddler 已知风险：Tifa/Sukuna 等）在 review UI 显式提示。用户授权确认（UGC 用于广告的 ToS 依据）标记在 Creative.extra，法务口径由 Cuddler 侧提供。
5. **实验闭环**：现有 `start_experiment` / `generate_creative_variant` / `rotate_creative` 工具直接可用——scene 素材 vs 官方制作素材的 A/B 是 Cuddler 试投期的第一个实验。

---

## 7. Agent 决策层升级

### 7.1 perceive 扩展

`perceive.ts` 新增数据块（现有 campaign 指标之外）：

```
funnel:      昨日/7日 分渠道 installs→activation→D1→trial→sub
cohorts:     近 4 周 cohort 的 D1/D7/LTV 曲线 + 环比
unitEconomics: 分渠道 CAC vs LTV(30d) vs gate 比值
creatives:   素材级 CTR/CVR 趋势 + 疲劳评分（频次×衰减）
sentiment:   AppReview 负面主题 Top3（P19 后）
skanNote:    iOS 渠道数据成熟度标记（<72h 数据不可信）
```

### 7.2 新增工具（沿用 `src/lib/agent/tools/` 注册模式）

| 工具 | 风险级 | 说明 |
|---|---|---|
| `reallocate_channel_budget` | 高（需审批） | 跨平台预算迁移（如 Meta iOS → ASA），带迁移上限 guardrail。这是 `01-vision.md` 长期愿景"跨平台预算重分配"的落地 |
| `adjust_asa_keyword_bid` | 中 | ASA 关键词出价 ±N%，复用 adjust-bid 的幅度约束模式 |
| `pause_creative` | 中 | 素材疲劳/低胜率时下线素材（跨 campaign 生效） |
| `raise_growth_alert` | 低 | CAC 击穿上限 / D1 异常下跌 / 负面评论激增 → Slack + PendingApproval 建议卡片（度量→人执行的有机渠道动作都走这里，如"建议给某 KOL 追加合作"） |
| `propose_paid_gate_change` | 仅建议 | 基于 cohort 数据建议开/关付费渠道（如"ASA 30d LTV:CAC=3.4，建议放量"），永远需人审批 |

### 7.3 新增 guardrail（Cuddler GTM 纪律 → 代码）

在 `guardrails.ts` 的 12 类之上新增 4 类，默认值来自 Cuddler GTM 文档，org 级可调：

| Guardrail | 规则 | 来源 |
|---|---|---|
| `payment_signal_gate` | **仅有真实付费信号（RevenueCat 订阅事件）才允许渠道放量**；proxy 指标（CPI/D1/trial）只能触发"降/停"，不能触发"加"。放量额外要求 eCAC*（含媒体补贴 COGS）≤ 阈值 | 辩论 P5 裁决（30d LTV:CAC 在 pilot 内数学上不可用，见 [01](01-5k-pilot-plan.md)） |
| `pilot_budget_cap` | pilot 期全渠道累计付费花费硬顶 **$5K**（org 配置），$4,750（95%）触发自动暂停 API 可达渠道 + kill-switch 通知；主保险为**平台原生账户 spending limit**，Adex 为下游 backstop | 辩论 P6 裁决 |
| `skan_maturity` | iOS SKAN 渠道（ASA、web 漏斗除外）装机数据 <72h 的 campaign，禁止任何自动调整；learning-phase 前 7 天仅告警不自动暂停（除非花费 >200% cap） | 辩论 P6 裁决 · SKAN 延迟 |
| `tier_cac_ceiling` | 分渠道 eCAC* 上限 = 首月净收入 × 目标回收系数，cron 每周按 CohortSnapshot 重算，Agent 不得出价超限 | unit_economics.md 单位经济 |

模式阶梯不变：Cuddler 从 shadow 起步 → pilot 期 approval_only → 数据充分后局部 autonomous。**付费渠道的放量决策永久停留在建议级（`propose_paid_gate_change`）——花不花钱、何时加码始终是人的决定。** pilot 期的完整判据与执行设计见 [01-5k-pilot-plan.md](01-5k-pilot-plan.md)。

---

## 8. UI / 报告改造

- **新增侧边栏"增长"分组**（复用现有 sidebar 分组模式）：
  - `/growth`：North Star + 全漏斗总览（分渠道桑基/漏斗图）
  - `/growth/cohorts`：cohort 留存/LTV 热力表（HakkoAI 留存热力图移植为 React 组件）
  - `/growth/channels`：渠道对比（CAC/LTV/量级/gate 状态灯）
  - `/growth/creators`：KOL 合作列表 + 单帖增量归因详情
  - `/growth/reviews`：评论流 + 情感/主题过滤 + P0 告警
- **周增长报告**（移植 HakkoAI weekly_report 模板）：cron 每周一生成 → Slack + 邮件（复用 `mailer.ts` + `notify.ts`），内容 = North Star 走势 + 渠道表 + cohort 摘要 + Agent 本周决策战绩 + 下周建议（LLM 生成，挂现有 PromptVersion 体系）。替代 Cuddler 手工周报。
- 现有 `/dashboard`（广告指标）不动；`/growth` 是它的上层漏斗视角。

---

## 9. Cuddler 对接契约（Integration Contract）

Adex 侧无法单方面完成的事项，需 Cuddler 仓库配合（多数已在其 P0 清单上）：

| # | Cuddler 侧需提供 | 对应其内部事项 | 阻塞 Adex 哪期 |
|---|---|---|---|
| C1 | GA4 属性只读授权（服务账号）| 已有 GA4，仅授权动作 | P18 |
| C2 | RevenueCat webhook 转发到 Adex ingest（或 API key）| release_schedule Phase 4（RC webhook 本就未配完） | P18 |
| C3 | App Store Connect API key（只读角色） | 已有 ASC 账号 | P18 |
| C4 | UTM / campaign 命名规范落地（`utm_source=adex_{platform}`、`utm_campaign={adex_campaign_id}`）| 深链参数透传 | P20 |
| C5 | 深链→install 归因打通（APPLE_TEAM_ID + Universal Links）| **其自身 GTM P0 阻塞项** | P19 K-factor 精度（缺失时降级为估算） |
| C6 | scene 分享事件 + 素材推送（`scene.shared` 埋点 + ingest 调用）| 其分享水印 P0 | P19（North Star）/ P20（素材管线） |
| C7 | UGC scene 用于付费广告的用户授权条款 | ToS 更新 | P20 素材合规 |
| C8 | KOL 合作台账初始数据（人肉表→导入） | 运营侧 | P19 |

**Adex 侧交付给 Cuddler**：专属 org + onboarding、ingest API key、`/growth` 看板、周报订阅、（P19 起）投放执行与审批流。建议每期结束做一次双方 30 分钟对齐会，契约变更记录在本目录 `02-integration-contract.md`（P18 期间从本节抽出成文）。pilot 期的新增前置见 [01-5k-pilot-plan.md §5](01-5k-pilot-plan.md)。

---

## 10. 路线图：Phase 18–21

> 承接 `docs/agent/09-roadmap.md`（P10–17 已完成）。单工程师 + AI 协作节奏，每期含 e2e 覆盖（`.claude/rules/testing.md`）与迁移。

### P18 · 增长数据底座 + web 漏斗测量臂（7 月，3 周）——"pilot 的度量脊柱"

1. Schema：`PromotedApp` / `ConversionEvent` / `CohortSnapshot` / `GrowthMetric` + 迁移
2. Connectors：`ga4.ts`、`revenuecat.ts`（API 拉取 + webhook ingest）、`app-store-connect.ts`
3. **web 漏斗测量臂**：GA4 web 转化事件（signup/subscribe）× UTM 归一化 → ConversionEvent（`channel=paid_meta_web` 等），这是 pilot 里绕开 SKAN 的确定性归因主臂（见 [01](01-5k-pilot-plan.md) P2 裁决）
4. `kpi-canon.ts` + cohort 重算 cron（`/api/cron/growth-sync`，纳入 CronSecret 体系）
5. UI：`/growth` 总览 + `/growth/cohorts`；Cuddler org 建立 + C1–C3 凭证接入

**验收**：Cuddler iOS 上线后 48h 内，Adex 显示 install→activation→D1→sub 漏斗，数字与 GA4/RC 后台偏差 <5%；web 转化事件端到端 <5min（webhook）；e2e：ingest 鉴权拒绝未签名请求。

### P19 · Pilot 使能：付费创建链路 + 预算守护 + 有机归因（8 月，3 周）——"$5K 试投跑得起来"

> 本期是 $5K pilot 的直接使能层。付费能力从 v1 的"9 月新阶段"前移至此，与有机归因并行。详细裁决见 [01-5k-pilot-plan.md](01-5k-pilot-plan.md)。

1. **Meta/TikTok 最小创建链路**：`OUTCOME_APP_PROMOTION`（iOS SKAN）+ web-conversion（→ cuddler.ai）两条 objective 分支；`Campaign.objective=app_install` + `promotedAppId`。pilot 自动化只开"降/停进审批队列"，禁止自动扩量（P3 裁决）
2. **预算守护引擎**：分渠道日 cap + 全局 $5K 台账；平台原生 spending limit 为主保险 + Adex set-and-verify 漂移核验 + 单向"降"自动动作（P6 裁决）
3. **ASA 手工投度量回灌**：ASA campaign 无 adapter，手工建；campaign ID 注册进 Adex + 每日 CSV 报表回灌 + 手工操作补记 AuditEvent
4. `CreatorPartnership`/`CreatorPost` + 自然增量归因 cron（基线 = 前 7 天同渠道均值，方法照搬 hakko-kol-agent）
5. `AppReview` + App Store RSS 抓取 + LLM 分类（prompt 移植 Feedback_agent）+ P0 负面 Slack 告警
6. UI：`/growth/channels`（含 gate 状态灯）、`/growth/creators`、`/growth/reviews`；周增长报告 v1
7. Guardrails：`pilot_budget_cap` / `skan_maturity` / `payment_signal_gate` / `tier_cac_ceiling`；`raise_growth_alert` 工具

**验收**：在 Adex 内完成一条 Meta web-conversion + 一条 Meta iOS app-install campaign 的创建→上线→报表回流→分渠道 CAC 入 cohort；ASA 手工投数据回灌进同一看板；`pilot_budget_cap` 触顶 e2e（模拟花费→自动暂停 API 可达渠道）；≥3 个真实 KOL 合作录入产出单帖 effectiveCpi；周报自动发出。

### P20 · 付费能力补全（9 月，3 周）——"ASA 原生 + app-install 自动化 + scene 素材"

1. `asa-adapter.ts`（campaign/adgroup/keyword CRUD + 报表）——把 P19 的 ASA 手工投升级为 in-Adex 自动化，本期最大单项
2. google-adapter App Campaign 路径 + 三平台 SKAN 报表列完善 + launch 校验器（SKAN campaign 数上限）
3. Scene-as-Creative：ingest + 打标 + review 流程 + 规格校验（**用户 scene 作素材前置 C7 授权条款**，pilot 首批用官方自制素材，P4 裁决）
4. 新工具：`adjust_asa_keyword_bid`、`pause_creative`、`propose_paid_gate_change`

**验收**：在 Adex 内完成一条 ASA campaign 的创建→上线→报表回流→CAC 入 cohort（替代 P19 手工）；scene 素材完成一次 review→push；官方自制素材 vs scene 素材的 A/B 实验跑通。

### P21 · Growth Agent（10 月，3 周）——"放量期的自动纪律"

1. perceive 全漏斗块 + `reallocate_channel_budget` 工具（approval_only）
2. 素材疲劳评分 + 自动轮换建议接入现有 experiment 工具
3. 周报 v2：Agent 战绩段 + 下周预算建议
4. Cuddler pilot 复盘 → guardrail 阈值校准 → 部分低风险工具切 autonomous
5. 压测：$10–50K/day 规模下 sync/cron 时效（Report 写入量、GA4 配额）

**验收**：一次完整的"Agent 建议跨渠道迁移预算→人审批→执行→7 天后 DecisionOutcome 复盘"闭环；Cuddler 增长负责人 NPS ≥8。

### Go/No-Go

- **P18 后**：漏斗数字可信（±5%）、web 转化实时？否则 pilot 不启动（一切判据以底座为准）
- **P19 后 = pilot 启动门禁**：付费创建链路 + 预算守护 e2e 通过、pilot 前置清单（[01](01-5k-pilot-plan.md) §启动门禁）全绿？否则 pilot 缩到最小臂（仅 web 漏斗 + ASA 手工）
- **pilot 中期**（花到 $2,500）：混合 eCAC* 是否入围？超阈值 → 冻结加码，只保留度量
- **P20 后**：Cuddler 决定放量？**未决定则 P21 顺延，Adex 转头服务第二客户接入**（多租户通用性验证）
- pilot 期任何一次超支事故 → 冻结 autonomous，回 approval_only 整改

---

## 11. 风险与对策

| 风险 | 概率/影响 | 对策 |
|---|---|---|
| Cuddler 推迟上线，pilot 窗口后移 | 中/中 | pilot 前置清单是配置级、可快速闭合；P18 度量底座独立有价值；pilot 启动按门禁而非日历（[01](01-5k-pilot-plan.md) P1 裁决） |
| SKAN 让 Meta/TikTok iOS 归因模糊 | 高/高 | **主测量臂改为 web 漏斗（GA4/Stripe 确定性归因，绕开 SKAN）**；iOS app-install 臂仅作 reach 测试不作判据；ASA 自归因兜底；`skan_maturity` guardrail 防误判 |
| GA4 Data API 配额/延迟 | 中/中 | 只拉 8 个关键事件的聚合；backfill 分日重放；ingest API 作实时兜底通道 |
| 双方 schema/埋点漂移 | 中/高 | §9 契约文档化 + ingest API 版本化（`/v1/`）+ 每期对齐会；事件名以 Cuddler `analytics_canon.md` 为准 |
| 单工程师带宽（4 期 13 周） | 高/中 | 每期都有"最小可交付子集"（P20 最小集=仅 ASA）；HakkoAI 配方移植而非重新发明；沿用现有 UI 组件/审批/cron 骨架 |
| 移植引入 HakkoAI 同款安全债 | 低/高 | ingest 全部 HMAC + 限流 + 幂等 unique 约束；凭证只进 Secret Manager；不复制其代码只移植逻辑 |
| Cuddler 特化侵蚀多租户通用性 | 中/中 | 所有 Cuddler 相关值（gate 阈值、事件映射、UTM 规范）都是 org 配置或 PromotedApp 数据行；code review 检查点：grep 不出 "cuddler" 硬编码 |
| UGC scene 作广告素材的授权/IP 风险 | 中/高 | 强制 review 流程 + IP 风险提示 + C7 契约（授权条款）前不推平台 |

---

## 12. 成功指标

**Adex 自身（平台视角）**：
- Cuddler 团队每周 ≥3 天活跃使用 `/growth`；周报完全替代手工拼表
- 增长数据端到端延迟：事件发生 → 看板可见 <24h（订阅事件 <5min，走 webhook）
- P20 后新客户接入同等能力（不含定制）≤3 天

**服务成效（Cuddler 视角，对齐其 GTM 指标）**：
- 试投期：分渠道 CAC/LTV gate 状态每日可见；预算超支事故 = 0
- Agent 建议采纳率 ≥50%，被回滚的自主动作 ≤5%（沿用 `01-vision.md` North Star）
- 放量期：从"指标恶化"到"预算/素材调整执行"中位时间 ≤1h（vs 手工 ≥24h）

---

## 13. 附录

### 13.1 引用文档

| 主题 | 路径 |
|---|---|
| Adex Agent 体系（承接基础） | `docs/agent/01-vision.md` … `09-roadmap.md` |
| Cuddler GTM 主文档 | `/Users/oratis/Projects/Claude/Cuddler/docs/gtm_strategy.md` |
| Cuddler 单位经济 | `…/Cuddler/docs/unit_economics.md` |
| Cuddler 事件口径 | `…/Cuddler/docs/analytics_canon.md` |
| Cuddler 发布计划/阻塞项 | `…/Cuddler/docs/release_schedule.md`, `roadmap_status.md` |
| HakkoAI KPI 口径与 SQL 配方 | `/Users/oratis/Projects/Claude/HakkoAI/data_agent/docs/CANONICAL_KPI_SPECS.md` |
| HakkoAI 反馈分类 prompt | `…/HakkoAI/Feedback_agent/scripts/feedback_llm_classify.py` |
| HakkoAI KOL 归因方法 | `…/HakkoAI/hakko-kol-agent/docs/DATA_CANON.md` |
| HakkoAI 订阅/LTV 配方 | `…/HakkoAI/Subscribe_Analysis/METRICS.md` |

### 13.2 术语

- **SKAN (SKAdNetwork)**：Apple 的隐私归因框架，iOS 广告装机归因延迟 24–72h 且粒度受限；ASA 不受其约束（自归因）
- **ASA**：Apple Search Ads，App Store 搜索广告
- **K-factor**：病毒系数 = 每个活跃用户带来的新装机
- **LTV gate**：LTV > 3× CAC 才允许渠道放量的纪律阈值（Cuddler GTM 规定）
- **Scene**：Cuddler 用户从对话生成的 5s cinematic 短视频，本方案中的核心广告素材来源

### 13.3 后续文档规划（本目录）

- [01-5k-pilot-plan.md](01-5k-pilot-plan.md)：**$5K 首投 pilot 设计（正反方辩论 + 裁决落地）——已成文**
- `02-integration-contract.md`：对接契约细则（P18 期间从 §9 抽出，随版本演进）
- `03-kpi-canon.md`：指标口径正式定义（与 `src/lib/growth/kpi-canon.ts` 同步维护）
- `04-asa-adapter-spike.md`：Apple Search Ads API spike 记录（P20 前置）
