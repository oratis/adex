# 在 Adex 上投放 Cuddler — 操作指南

> Version v1 · 2026-07-04 · 面向:运营 Cuddler $5K pilot 的人
> 配套:[01-5k-pilot-plan.md](01-5k-pilot-plan.md)(为什么这么投)· [02-integration-contract.md](02-integration-contract.md)(Cuddler 侧要提供什么)· [03-creative-studio.md](03-creative-studio.md)(物料)

按顺序做。标 ⚙️ 的是当前用 API/配置完成(UI 待补),其余都有页面。

---

## 0. 开始前:门禁清单

主投 $4,500 前,这几项必须绿(详见 [02 §3.1](02-integration-contract.md)):

- [ ] RevenueCat webhook 指向 Adex(真实付费信号)
- [ ] GA4 web 转化事件带 UTM(主测量臂)
- [ ] AdServices token + web pixel 上线
- [ ] Cuddler 视频分层日上限上线(封 loss-leader)
- [ ] 各广告账号设 account spending limit = $5,000
- [ ] 10–14 条官方自制 IP-洁净素材就绪

---

## 1. 建工作区 + 接账号(第 1 天)

1. **登录 Adex**,进你的 Cuddler workspace(`/settings` 可切换/新建 org)。
2. **接广告平台**(`/settings` → 平台):OAuth 接 **Google / Meta / TikTok**。**Apple Search Ads** 本期手工投(无 adapter),但把 campaign id 回填进 Adex 做统一度量。
3. ⚙️ **注册 Cuddler 为 Promoted App**:`PromotedApp{ name:"Cuddler iOS", platform:"ios", bundleId:"com.cuddler.main", storeId:"6785787387", deepLinkDomain:"cuddler.ai" }`。app_install/web_conversion campaign 靠它做 SKAN 上限校验。
4. ⚙️ **接数据源**(存进 `PlatformAuth`):
   - `platform:"revenuecat"` → apiKey = RC webhook 密钥;RC 后台 webhook 指向 `POST /api/ingest/revenuecat?org=<orgId>`
   - `platform:"ga4"` → GA4 属性只读授权(service account)
   - `platform:"app_store_connect"` → ASC `.p8`(评论/装机;只进 Secret Manager)
   - `platform:"ingest"` → apiKey = 事件推送 HMAC 密钥(供 `/api/ingest/events`、`/api/ingest/scenes`)

---

## 2. 配置 pilot(第 1 周)

**渠道分臂**(裁决见 [01 §P2](01-5k-pilot-plan.md),按归因洁净度而非平台):

| 臂 | 渠道 | 预算 | 角色 |
|---|---|---|---|
| web 漏斗(主测量) | Meta→web $1,250 + TikTok→web $750 | $2,000 (40%) | GA4/Stripe 确定性归因,绕开 SKAN |
| ASA | Apple Search Ads | $1,250 (25%) | iOS 意图 + 自归因 |
| iOS-SKAN | Meta iOS $500 + TikTok iOS $250 | $750 (15%) | 只测触达,不作判据 |
| 机动 | 过 Gate B 后加给赢家 | $1,000 (20%) | — |

**Guardrails**(`/guardrails`):`pilot_budget_cap` $5K、`skan_maturity`、`payment_signal_gate`、`tier_cac_ceiling` 已内置;确认阈值。**主保险仍是各平台原生 spending limit**(上一步已设)。

**探针先跑**:账号开好即跑 Phase 0 探针 $500(Meta/TikTok 各 $250),只预热账号 + 测素材 CTR/过审,**不做 kill/scale 结论**。

---

## 3. 做物料(Creative Studio,`/creatives/studio`)

1. **建 brief**:填 product(`Cuddler — Playable Stories`)、audience(`CAI 难民 / RP 创作者`)、angle、hooks(逗号分隔,如 `分支瞬间, chat→film, 语音对比`)、平台、语言。
2. 点 **Generate variants** → 自动扇出 **DCO 变体矩阵**(平台×格式×钩子×语言),每格附**自动符合各平台字符上限**的文案 + 规格状态灯。
3. **产出**:对变体调 `POST /api/creatives/studio/produce` → 生成分镜(钩子→scene→尾卡)+ 审核门控的 Creative。⚙️ 实际渲染接 Seedance2/Seedream(需 `SEEDANCE2_API_KEY`)。
4. **首批用官方自制素材**(非用户 scene,IP/水印原因,见 [01 §P4](01-5k-pilot-plan.md));用户 scene 经 `/api/ingest/scenes` 导入后走审核。
5. **审核**:`/creatives/review` 人工 approve 后素材才能推平台(IP/授权门)。

---

## 4. 建广告并上线

1. `/campaigns` → 新建。**objective 选 `app_install`(装机)或 `web_conversion`(网页订阅)**,关联上一步的 Promoted App。
2. 关联审核通过的素材,设预算(用 §2 的分臂数),targeting(英语区 US/UK/CA/AU)。
3. **Launch**:Adex 先跑 `validateLaunch`——检查 app 要求 + **SKAN iOS campaign 上限**(Meta ≤9),不合规直接拦并提示;通过则经 adapter 建 campaign(平台侧默认 PAUSED,你确认后激活)。⚙️ Meta/TikTok 真实 app-install 写入需平台 sandbox 凭证接通。
4. **ASA**:手工在 ASA 后台建(exact match 品类词/竞品词),campaign id 回填 Adex + 每日报表导入。

---

## 5. 看数据(`/growth`)

| 页 | 看什么 |
|---|---|
| **Overview** | install→激活→D1/D7→订阅→收入 全漏斗 + `live●` agent 心跳 |
| **Channels** | 分渠道 CAC/eCAC\*/订阅率 + **实时 gate 状态灯**(scale/hold/halve/kill)——与 Agent 同一判据 |
| **Cohorts** | 获客日×渠道 留存/LTV 热力表 |
| **Creators** | KOL 合作 + 单帖自然增量归因(effective CPI) |
| **Reviews** | App Store 评论 + 情感/主题/P0 过滤 |

**定时任务**(Cloud Scheduler,带 `X-Cron-Secret`):`/api/cron/growth-sync`(每日重算 cohort)、`/api/cron/review-sync`(拉评论 + 分类)、`/api/cron/agent`(每小时 agent)。

---

## 6. 开 Agent(`/agent-onboarding`)

1. 先 **shadow 模式**:agent 每小时感知全漏斗 + 分渠道 gate + 预算,记录决策不执行。看 `/decisions`。
2. 稳定后切 **approval_only**:决策进 `/approvals` 等你点确认。Agent 的增长动作:
   - `raise_growth_alert` — CAC/D1/评论/预算异常提醒
   - `pause_creative` — 疲劳素材下线
   - `propose_paid_gate_change` — **建议**开/关渠道(永不自动花钱,你决定)
   - `reallocate_channel_budget` — 跨渠道预算迁移(高危,必审批)
3. **付费放量决策永远是人的**:proxy 指标只能降/停,加码必须见真实付费信号。

---

## 7. pilot 决策循环(约 20 天)

按单渠道累计花费触发(判据见 [01 §P5](01-5k-pilot-plan.md),Channels 页的 gate 灯实时显示):

- **$400/渠道** → Gate A:装机<50 或 CPI>$8 或首聊<40% → **kill**
- **$800/渠道** → Gate B:真实付费<3 → 预算减半
- **$1,250/渠道** → Gate C:付费≥5 且每付费成本≤$42.5 → **释放机动预算加码**
- **累计 $2,500** → 混合 eCAC\*>$8 → 冻结加码

诚实边界:$5K 只能答"哪个渠道最值得更大预算去测",答不了"哪个已盈利"。

---

## 8. 日常节奏

- **每天**:扫 `/growth/channels` gate 灯 + `/approvals` + `/growth/reviews` 的 P0;确认 spend 未逼近 cap。
- **每周**:周增长报告(自动发 Slack/邮件)= North Star + 渠道表 + cohort + Agent 战绩 + 下周建议。
- **触顶**:全局 $4,750(95%)Adex 自动暂停 API 可达渠道 + kill-switch 通知(ASA 靠原生 cap + 每日对账)。

---

## 附:当前 UI 待补(⚙️ 项)

Promoted App 注册、数据源密钥录入目前是 API/配置级,Studio 产出的实际渲染 + Meta/TikTok 真实 app-install 写入需外部凭证——清单见 [04-status.md](04-status.md)。这些不阻塞度量 + 有机归因 + web 漏斗投放。
