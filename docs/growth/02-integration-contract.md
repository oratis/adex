# Adex × Cuddler 对接契约（给 Cuddler 团队）

> 版本：v1 · 2026-07-04 · 面向：Cuddler 工程 / 增长 / 财务团队
> 配套：Adex 侧方案 [00-cuddler-first-redesign.md](00-cuddler-first-redesign.md) · $5K pilot 设计 [01-5k-pilot-plan.md](01-5k-pilot-plan.md)
> 目的：一页看清「Adex 给你什么、需要你配合什么、什么时候要」。**本文可冷读，无需先读前两份。**

---

## 1. 这是什么

Adex 是一个 AI 广告增长平台。我们要把它重构成服务 Cuddler 付费增长的**增长操作系统**：把你分散在 GA4 / RevenueCat / App Store / 各广告后台的数据合并成一份**分渠道全漏斗**（装机 → 激活 → 留存 → 订阅 → LTV），并在此之上支撑你的 **$5,000 首投 pilot**——从建广告、控预算到判断哪个渠道值得加码，全程在一个面板里完成，而不是手工拼表。

**第一步是 pilot**：$5K 是"买决策数据的信息预算"，约 20 天花完，回答"哪个付费渠道最值得用更大预算正式测"。要跑起来，需要你我两边各就位一些东西——就是本文的核心。

---

## 2. Adex 交付给你的

| 交付物 | 内容 | 时点 |
|---|---|---|
| 专属工作区 | Cuddler 独立 org + 成员 onboarding + 权限 | P18（7 月） |
| `/growth` 增长看板 | 分渠道漏斗、cohort 留存/LTV 热力表、渠道对比（含 gate 状态灯）、$5K 台账进度 | P18–P19 |
| Ingest 接入 | 一个 org 级 API key + 接收你数据的端点（见 §5） | P18 |
| 投放执行 | 在 Adex 内创建/管理 Meta、TikTok 广告 + 审批流 + 预算守护 | P19（8 月，pilot 使能） |
| 评论舆情 | App Store 评论自动抓取 + AI 情感/主题分类 + 负面 P0 告警到 Slack | P19 |
| KOL 归因 | 创作者合作台账 + 单帖自然注册增量归因 | P19 |
| 周增长报告 | 每周一自动出：North Star 走势 + 渠道表 + cohort 摘要 + 下周建议，发到 Slack/邮件 | P19 |

---

## 3. 需要你配合的（核心）

### 3.1 硬阻塞项 —— 缺任一项，$5K 主投无法启动

这 6 项是 pilot 主投（$4,500）的**启动门禁**。我们按门禁清单启动、不按日历——你晚就绪，pilot 顺延，但不会为赶日期跳过。

| # | 需要你提供 | 你侧对应的事 | 为什么是硬阻塞 |
|---|---|---|---|
| **G1** | RevenueCat webhook 填好 secret 并转发到 Adex ingest（或给只读 API key） | 你的 release_schedule Phase 4 本就有 RC webhook 项，目前 secret 未配 | 没有真实付费信号，pilot 只能盲目 kill 渠道、无法判断谁值得加码 |
| **G2** | GA4 的 web 转化事件（`auth.signup_completed`、`subscription.activated`）带上 UTM 参数、校验能收到 | 埋点已在，只需确认 web 端注册/订阅链路把 UTM 透传进事件 | **web 漏斗是 pilot 的主测量臂**（占 40% 预算），无此则这部分钱测不出效果 |
| **G3** | Apple AdServices token 采集端点 + web pixel（Meta/TikTok）上线 | iOS 归因入口 + 网页转化回传 | ASA 与 web 漏斗的归因入口 |
| **G4** | 视频生成分层日上限上线（免费档每日可生成视频条数封顶） | 你的 unit_economics 重定价方案里的一部分，配置级即可先行 | 每条视频净亏 $0.5–1，不封顶则付费引流会放大亏损；这是保护你自己单位经济的闸 |
| **G5** | 各广告账号设 account-level spending limit = $5,000；ASA console 设 lifetime budget | 运营在各平台后台设置 | 预算的**主保险**——平台原生上限零延迟、在竞价层生效，比任何下游系统都可靠 |
| **G6** | 官方原创角色素材源（供 Adex 生成 IP-洁净的首批广告素材） | 提供可用于商业广告的官方角色（非用户导入角色） | 见 §4 素材说明 |

> **G4 说明**：我们特意把它列为硬阻塞，是为保护你。pilot 会给产品引入付费用户，若视频不限量，亏损敞口不可控。只需"免费档每日视频条数上限"这个配置，不必等整套重定价灰度完成。

### 3.2 命名规范 —— 主投前对齐

广告落地链接的 UTM 参数需按此透传到 cuddler.ai，Adex 才能把网页转化归因到正确的广告：

```
utm_source   = adex_{arm}         例：adex_meta_web / adex_tiktok_web / adex_asa
utm_campaign = {adex_campaign_id}  Adex 建广告时生成，回传即可
utm_medium   = paid
```

### 3.3 后续项 —— pilot 之后（非阻塞）

| 需要你提供 | 用途 | 时点 |
|---|---|---|
| 深链→装机归因打通（APPLE_TEAM_ID + Universal Links） | 精确 K-factor（缺失时我们先用估算值） | 你的分享功能 P0 |
| `scene.shared` 埋点 + scene 素材推送到 Adex | North Star（周外部分享数）+ 用户 scene 作广告素材 | 你的分享水印 P0 |
| UGC scene 用于付费广告的用户授权条款（ToS 更新 + 创作者 opt-in） | 用户生成的 scene 合法用作广告素材 | P20 素材管线前 |
| KOL 合作台账初始数据（现有人肉表导出） | 导入 Adex 做归因 | P19 |

---

## 4. 素材说明（为什么 pilot 首批不用用户 scene）

你的战略是"产品即广告"——用户生成的 cinematic scene 本身就是最好的广告素材。**我们认同这是长期正确的方向**，但 pilot 首批先用**官方自制素材**，原因：

1. 分享水印管线（你侧 P0）尚未完成，用户 scene 导出目前无水印/深链；
2. 产品内置角色卡导入 → 大量用户角色是动漫/竞品 IP，在 feed 里流通与"用于付费广告投放"是两个法律责任层级；
3. 用户 scene 原片 5s、无广告钩子/结尾 CTA，裸投浪费流量。

**pilot 首批 = 10–14 条官方自制**：Adex 用你的 AI 生成能力 + 官方原创角色产出，结构为「3s 钩子 + 5s scene + 2–4s 结尾 CTA」，开启 AIGC 标注，过 IP 审查。用户 scene 作素材在 §3.3 的授权条款到位后（P20）接入。

---

## 5. 数据接口（Ingest API）

Adex 提供三个端点接收你的数据。鉴权 = org 级 API key + 请求体 HMAC 签名 + 时间戳防重放。

```
POST /api/ingest/revenuecat   RevenueCat webhook 转发（订阅/试用/续费/退订，近实时）
POST /api/ingest/events       批量事件（GA4 之外的补充通道，备用）
POST /api/ingest/scenes       scene 素材元数据（P20 起，用户 scene 作素材时）
```

我们主要通过**你授权的 GA4 只读 + RevenueCat**主动拉取，Ingest API 是实时兜底通道。你只需完成 G1（RC webhook 指向 `/api/ingest/revenuecat`）即可。

**我们会用到的事件**（沿用你 `analytics_canon.md` 的既有事件名，无需你新增）：
`auth.signup_completed` · `chat.started` · `subscription.activated` · `subscription.cancelled` · `credit.spent` · `paywall.viewed` · `scene.generated`（+ 后续 `scene.shared`）。

---

## 6. 时间线

```
7 月  Adex P18：数据底座 + web 漏斗测量臂 + 你的工作区/看板就绪
      ├─ 你：G1（RC webhook）、G2（GA4 web 事件校验）、G3（token/pixel）
      │
8 月  Adex P19：Meta/TikTok 建广告链路 + 预算守护 + 评论/KOL 归因
      ├─ 你：G4（视频日上限）、G5（账号 spending limit）、G6（官方素材源）
      │
门禁全绿 ──► $5K pilot 启动
      ├─ Phase 0 探针 $500（预热账号、测素材，可在门禁未全绿时先跑）
      └─ 主投 $4,500 @ $150→$250/日，约 20–30 天
      │
9 月  pilot 复盘 → 决定放量 or 调整；Adex P20 补全 ASA 自动化 + scene 素材管线
```

---

## 7. 需要你拍板的三个问题

1. **视频重定价与 pilot 的先后**：我们的方案只要求"免费档视频日上限"先行（G4），不必等整套重定价。但若你判断存量订阅者的旧价 grandfather 损失敏感，可要求重定价先做、pilot 顺延——**这个决策权在你**。
2. **web 端能否承接付费流量**：pilot 主测量臂把用户导向 cuddler.ai 注册订阅。需你确认 web 端 onboarding/paywall 转化体验够好；若 web 转化明显弱于 App，我们把测量重心回调向 ASA。
3. **可接受的回收周期**：pilot 的"放量放行"门设为「每付费用户成本 ≤ 5× 首月净收入（约 $42.5）」，隐含约 5 个月回收假设。需你财务确认这个回收周期可接受。

---

## 8. 分工速查

| | Cuddler | Adex |
|---|---|---|
| 归因埋点 / webhook / token | ✅ 提供并验证 | 接收、归一、入库 |
| 广告账号 + 原生预算上限 | ✅ 开户、设 spending limit | 写 campaign 预算、每日核验漂移 |
| 视频日上限 / 重定价 | ✅ 产品侧上线 | 在看板反映单位经济 |
| 官方素材源 | ✅ 提供原创角色 | 生成广告素材 + 过审 |
| 建广告 / 控预算 / 判渠道 | 审批关键动作 | 执行 + 守护 + 出判据 |
| 决策（放量/回收周期/重定价先后） | ✅ 拍板 | 提供数据支撑 |

---

**联系 / 变更**：本契约随 pilot 推进更新，重大变更在本文件记录版本。建议每个阶段末做一次双方 30 分钟对齐。
