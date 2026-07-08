# 竞品情报 + 物料 Remix — 完整调研方案 (P22)

> Version v1 · 2026-07-08 · 作者调研:实地走查 AppGrowing Global 会员账号 + 通读 Adex 现有创意链路
> 关联:[00-cuddler-first-redesign.md](00-cuddler-first-redesign.md) §6(Scene-as-Creative)· [03-creative-studio.md](03-creative-studio.md)(物料能力)· [04-status.md](04-status.md)(render seam 待补)
> 目标:用 AppGrowing 会员账号,给 Adex 装上两件事 —
>
> 1. **竞品情报**:把竞品的整体物料库 + 数据分析能力接进 Adex(可搜、可看、可沉淀)。
> 2. **物料 Remix**:以竞品爆款物料为"结构/钩子/卖点参照",用我们自己的 AI 生成栈(Seedance2 / Seedream / Claude)产出**本产品自己的**差异化物料。

***

## TL;DR(先看这段)

* AppGrowing 是一个 **10 亿级广告素材情报库(账号内实测 4,500 万条可检索)**,覆盖 30+ 媒体渠道,每条素材都带**深度结构化元数据 + 一层 AI 分析**(卖点、情绪触发点、画面理解、逐镜 storyboard、语音转写、BGM 识别,以及**从任意片段反推一段 T2V 生成 prompt**)。这正是 Remix 的上游燃料。

* Adex 侧 **90% 的下游已经建好**:Creative Studio(brief→变体矩阵)、`Asset.referenceData` 多模态参照位、Seedance2 `video2video/full` 生成、`ingest/scenes` 幂等入库模板、`review→push` 审核门。[04-status.md:26](04-status.md) 里那条"变体→真实 Seedance2 job→转码→推送"的 **render seam 一直空着 —— 本方案正好把它对竞品物料这一路补上**。

* **关键取数决策**:官方合规通道优先(会员套餐内的下载/Collections 导出,或厂商宣传的 "Ad Creative Skill" for AI agents —— 待与 AppGrowing 确认),**不要**把爬内部 GraphQL 当主路径(脆弱 + 违反 ToS + 封号风险)。

* **法务是头号约束,不是脚注**:仓库里已把"广告物料含第三方/竞品 IP"定性为**独立法律层级**([02-integration-contract.md:74](02-integration-contract.md))。本方案的核心设计原则是 **"借结构、不复刻"(derive, don't copy)** —— 竞品素材只作分析/参照输入,**产出永远是我们自己的 IP/品牌/角色**,且**任何物料上线前必须过人工审核门**。

* **建议路线**:先做零基建的 **Phase 0 手工 PoC**(本周,10\~20 条爆款 → 走一遍 Studio→Seedance2→审核),验证全链路 + 拿法务口径;跑通再依次上 竞品库入库 → Remix 引擎 → 每日自动同步。

***

## 1. AppGrowing 能力盘点(账号内实测)

> 图例:✅ = 本次登录账号内亲眼确认;📢 = 厂商官网宣传、需向 AppGrowing 侧确认;💰 = 计费/限额项。
> 账号语境:本次进入的是 **Game / US 区 / 某竞品 appBrand** 的 market-dashboard(URL 参数 `purpose=1&appBrand=…&subjectArea=US`)。

### 1.1 数据广度

| 项               | 观察                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 素材规模            | ✅ Ad Creatives 库检索显示 **"45.0M results found"**;📢 官网称 "1 billion+ ad creatives across 30+ channels"                                                                                                                                                                       |
| 媒体渠道            | ✅ Meta Ads / Google Ads / TikTok for Business / Facebook / Instagram / Facebook (FAN) / AdMob …(可多选过滤)                                                                                                                                                                    |
| 顶部导航            | ✅ Dashboard · Creatives · Insights · Analytics · Store · Collections                                                                                                                                                                                                      |
| Creatives 左栏    | ✅ Competitor Innovative Creatives、TikTok/Facebook Creative Picks;**Ad Intelligence**:Ad Creatives、Top Clips(🔒New/未解锁)、Ad Descriptions、W2A Landing Pages、Pre-Register Pages、Playable Ads;**Store Creatives**:LiveOps Creatives(🔒Pro);**AI Creatives**:AI Voice Generator |
| Insights(套餐功能表) | 📢 Top Apps / Top Developers / Top APKs / Top AI / Top AI Websites / Top Short Dramas / Top Novels / Game Trends / CPM Trends / App Store Charts / Google Play Downloads / New Apps …                                                                                     |
| 内部数据 API        | ✅ 前端全部走 **GraphQL**:`POST https://api-appgrowing-global.youcloud.com/graphql`(非公开、无文档、Cookie 鉴权)                                                                                                                                                                          |

### 1.2 检索与过滤维度(Ad Creatives / `/leaflet`)

✅ 亲测过滤器极其丰富,这是"竞品数据分析能力"的主体:

* **Creatives / Ads 双视图** + Exact match 开关 + Deduplication Statistics

* **Store Category**(Action/RPG/Casual/…)、**Game Tags**(Themes/Gameplay/Role Playing/…)、**Creative Tags**(Sub-gameplay / Visual Format / Character Type / Character Face / Character Age Group / Number of Characters …)

* **Media**(上述渠道多选)

* **Date**:Last 7/30/180/365 Days · All · 自定义区间 · **Latest / New Ads / Innovative Creatives(AI 判定"创新")/ Pre-registration**

* **Ad Attributes**:Regions、Languages、Platforms、**Ad Format**、**Ad Days(在投天数 = 长青度/间接效果代理)**、Audience Analysis、Monetization Approach、Promotion Types、Promotion Platforms、Custom Product Pages、Original Post、Violating Ad、Cooperative Ad

* **Creative Attributes**:Creatives Types、**Aspect Ratio**、**Video Duration**、HD、**With Voiceover**、Voiceover Languages

* **🌟 AI Selling Point Filter**(用 AI 打的语义标签直接当过滤条件):Core Selling Points、Emotional Triggers、Screen Understanding、Characters、Selling Point、User Objective、Audience Assumption、BGM & Voiceover

### 1.3 单条素材的元数据 + AI 分析(Remix 的核心燃料)

✅ 点开任意一条(实测 Arknights 一条 Google Ads 视频),detail 抽屉给到两层:

**A. 硬元数据**
`Video 640×360` · 版式 `In-Stream Video / Rewarded / In-Feed`(带 Android/iOS)· Media(投放渠道)· **Ad Platform** `Google Ads` · **Region** `Japan` · **Ad Days** `1,942 天` · **Impressions** `710.4K` · Similar Creatives / **Related Ads** `19` · **Duration**(首见\~末见)`2021-03-15 ~ 2026-07-08` · **Original Post**(常直链 YouTube 等**公开原始出处**)。

**B. AI 分析(逐条,标签页切换)**

| Tab                   | 产出                                                                                                                                                                                                       | 计费                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **Creative Overview** | Creative Tags(Fiction Style/2D/3D/Anime Characters/…)· **Core Selling Points**(演技张力/光效冲击/机甲特效/…)· **Emotional Triggers**(战斗张力/操作爽感/…)· **Screen Understanding → Primary Visual Elements**(角色/机甲/道具/光效逐项) | 通常已缓存                   |
| **AI Prompt** 🌟      | **从任意 ≤1min 片段反推一段可用于文生视频的 prompt**(English/Chinese)。**这是 Remix 的"半成品":一段结构化的生成描述**,可直接喂我们的 Seedance2。                                                                                                   | 💰 **3 AI Points / 次**  |
| **Speech to Text**    | 口播/旁白**逐字转写**(可做脚本参照 + 多语本地化)                                                                                                                                                                            | 💰(计点)                  |
| **BGM Recognition**   | 背景音乐识别(⚠️ 音乐版权敏感,见 §6)                                                                                                                                                                                   | 💰(计点)                  |
| **Video Split**       | **Storyboard Extraction —— 逐镜拆解**(镜头级 storyboard,用于抽参考帧)                                                                                                                                                 | 💰 **10 AI Points / 次** |

### 1.4 计费与限额(💰 —— 会直接决定 Remix 规模化成本)

* **AI Points 计点制**:实测余额 **32,000 点**,其中 **2,000 点本月过期**(用进废退)。AI Prompt 3 点 / Storyboard 10 点 → 一条素材若两样都抽 ≈ **13 点**。

* **下载受套餐门禁**:实测某条素材 Download 提示 **"Insufficient permissions. Please upgrade your plan."**;而 **Enterprise 套餐** 功能表标注 `Ad Download: Unlimited` / `Searching: Unlimited`(Top Apps、App Ad Overview 各 50/月)。→ **本账号非 Enterprise,下载与抽取都有额度**。

* **Collections**:可把素材收藏进 Collections(团队版 100G),配合官方**浏览器插件**"Collect Videos on Web Pages"批量收集 —— 这是一条**官方许可的导出路径**。

### 1.5 官方 AI-Agent 接入(📢 待确认,可能是最优取数路径)

官网检索到:AppGrowing 宣称提供一个 **"dedicated Ad Creative Skill",可插入 Claude / ChatGPT / 自定义 agent,实时问答并拉取 AppGrowing 数据**("Select creatives, ask questions … our AI analyzes the creative strategy")。若属实,这是**最合规、最省事**的程序化取数通道 —— 但**当前会员套餐功能表里没有明列**,需**向 AppGrowing 销售确认**(是否含在套餐/加购/是否给 API key 或 MCP endpoint)。**在确认前,不把它写进关键路径**。

***

## 2. Adex 现状 —— 下游几乎已就绪

> 全部 file:line 来自本次仓库走查。**仓内目前没有任何 appgrowing/竞品/remix 代码**,以下都是可直接对接的现成 seam。

### 2.1 生成栈(Remix 的"产出端")

| 能力               | 入口                                                                                                      | 形状                                                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seedance2 视频     | `POST /api/seedance2/generate` [route.ts:8](../../src/app/api/seedance2/generate/route.ts)              | body `{ prompt*, mode:'text2video'\|'image2video'\|'video2video'\|'full', referenceImages?[], referenceVideos?[], referenceAudios?[], generateAudio?, ratio?, duration? }` → 建 `Asset(source:'seedance2', status:'generating', taskId, model)`,**参照 URL 落** **`Asset.referenceData`(JSON)** ← Remix 参照位就在这 |
| 轮询回写             | `GET /api/seedance2/status?taskId=&assetId=` [route.ts:8](../../src/app/api/seedance2/status/route.ts)  | 成功写 `Asset.fileUrl=output.video_url, status:'ready'`                                                                                                                                                                                                                                                       |
| Seedance2 client | [src/lib/platforms/seedance2.ts](../../src/lib/platforms/seedance2.ts)                                  | `createAdCreative`(全多模态:text+image+video+audio refs);content 支持 `role:'reference_image'\|'reference_video'\|'reference_audio'` —— **竞品帧/视频作参照就喂这里**                                                                                                                                                        |
| Studio(brief→矩阵) | `POST /api/creatives/studio` [route.ts:44](../../src/app/api/creatives/studio/route.ts)                 | `{ product*, platforms*[], audience?, angle?, hooks?[], languages?[] }` → `CreativeBrief` + `CreativeVariant` 矩阵 + 逐平台限字文案                                                                                                                                                                                 |
| Studio 出片        | `POST /api/creatives/studio/produce` [route.ts:20](../../src/app/api/creatives/studio/produce/route.ts) | `{ variantId }` → 组 storyboard+文案成 prompt,建 `Creative(source:'agent', reviewStatus:'pending')`。**注释 :12 明说实际 render 是"credentialed follow-up" —— 这就是那条空着的 seam**                                                                                                                                           |
| 文案               | `POST /api/creatives/generate-copy` [route.ts:15](../../src/app/api/creatives/generate-copy/route.ts)   | `{ productDescription*, audience?, tone?, platform?, count? }` → `{ variants:[{headline,description,callToAction}] }`,限 30/hr/user                                                                                                                                                                         |

### 2.2 入库 / 同步模板(Remix 的"上游端")

| 用途       | 模板                                                                                                                                            | 复用点                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 推送式入库    | `POST /api/ingest/scenes?org=` [route.ts](../../src/app/api/ingest/scenes/route.ts) + [scene-import.ts](../../src/lib/growth/scene-import.ts) | HMAC 鉴权 → 解析 → LLM 打标 → **按** **`(orgId, sourceRef, source)`** **幂等** → 建 `Creative(source:'imported_scene', reviewStatus:'pending')`。**竞品入库直接克隆这套** |
| 每日拉取     | `POST /api/cron/review-sync` [route.ts:47](../../src/app/api/cron/review-sync/route.ts)                                                       | 遍历 org → 拉外部 feed → LLM 分类 → **按外部 id upsert 幂等**。**竞品每日同步照抄:遍历 org → 拉 AppGrowing 精选 → 存 GCS → upsert**                                             |
| Cron 鉴权  | [src/lib/cron-auth.ts:34](../../src/lib/cron-auth.ts)                                                                                         | `verifyCronAuth(req, 'competitor-sync')` + 注册 `CronSecret` 行                                                                                         |
| 文件→Asset | `POST /api/assets/sync` [route.ts](../../src/app/api/assets/sync/route.ts)                                                                    | Google Drive 递归拉取、按 `driveFileId` 去重 —— **抓取远端媒体入 Asset 的可用范例**                                                                                      |
| GCS 存储   | [src/lib/storage.ts:49](../../src/lib/storage.ts)                                                                                             | `uploadToGCS(buffer, filename, contentType) → 公网URL`。**抓 AppGrowing 媒体 → Buffer → uploadToGCS → 即成 Seedance2 的** **`reference_video/image`**         |
| 数据源连接器位  | [src/lib/platforms/](../../src/lib/platforms/) (`gdrive.ts`/`appsflyer.ts` 这类只读)                                                              | 新增 `appgrowing.ts`,归入 [00 §DATA\_SOURCE\_PLATFORMS](00-cuddler-first-redesign.md) 的**只读数据源**一类                                                       |

### 2.3 数据模型(现有,可挂靠)

* **`Asset`** [schema.prisma:464](../../prisma/schema.prisma):`orgId/type/source/fileUrl/thumbnailUrl/prompt/`**`referenceData(JSON)`**`/taskId/status/ratio/duration/model/tags(JSON)/`**`driveFileId(去重)`** —— **竞品原始媒体的落脚点**(`source:'appgrowing'`)。

* **`Creative`** [schema.prisma:331](../../prisma/schema.prisma):`source(…imported_scene)/`**`sourceRef(溯源)`**`/tags/`**`reviewStatus(none/pending/approved/rejected)`**`/platformPolicy` —— **Remix 产物 + 审核门**。

* **`CreativeBrief`/`CreativeVariant`/`Campaign`/`Report`/`PlatformAuth`**([:209](../../prisma/schema.prisma),`@@unique([orgId,platform])`,open-ended `platform` 字符串 —— **`appgrowing`** **凭据/Cookie 存这**)。

* ⚠️ **无** **`CreativeJob`** **模型**:Seedance2 job 态内联在 `Asset.taskId+status`。若要**可查询的 Remix job 队列**,需新增模型(见 §4)。

### 2.4 LLM(Remix 的"大脑")

[src/lib/llm.ts](../../src/lib/llm.ts):默认 **`claude-sonnet-4-5`**(可 `ANTHROPIC_MODEL` 覆盖)。

* `completeWithStructuredTool<T>()` [:130](../../src/lib/llm.ts) —— 强制 tool-use 出结构化 + prompt-caching。**最适合做"Remix brief 抽取器":读竞品分析 + 我方产品 brief → 吐一份差异化 storyboard + Seedance2 prompt + 文案骨架**。

* ⚠️ **现有 helper 全是纯文本 in/out,没有图像/视频输入块**。两条路:(a) **靠 AppGrowing 已抽好的 AI 分析**(卖点/storyboard/AI Prompt/转写)当文本输入 —— **推荐,零改造且省点数**;(b) 若要 Claude **亲自看**竞品画面,给 `llm.ts` 加一个多模态 `completeWithMedia` 变体。

***

## 3. 目标能力设计

### 3.1 能力一:竞品情报库(Competitor Intelligence)

把 AppGrowing 的检索/分析能力**沉淀进 Adex**,而不是每次去 AppGrowing 现查:

```
AppGrowing 精选竞品素材
   │  取数(见 §5 决策:官方导出 / Collections / Skill)
   ▼
CompetitorCreative(我方竞品库) ── 关联 ──► Asset(GCS 存的媒体)
   │  元数据 + AI 分析(卖点/情绪/画面/storyboard/转写/AI Prompt/Ad Days/Impressions)
   ▼
Adex 内可搜可筛的竞品面板(按 app/渠道/卖点/在投天数/曝光排序)
   → 直接回答:"这个赛道最近哪些钩子/卖点在赢?哪些创新素材值得 Remix?"
```

**独立价值**:即便不做 Remix,一个"我方自己的、可沉淀、可跨会话复用的竞品洞察库"本身就有价值(AppGrowing 会员是个人视角、易过期;Adex 里是团队资产 + 可接进 Growth Agent)。

### 3.2 能力二:物料 Remix(核心)

```
CompetitorCreative(选定的爆款)                 我方产品 brief(product/IP/brand/audience/角色)
   │  分析层:卖点、情绪触发、逐镜 storyboard、           │
   │         hook 时序、AI Prompt、口播脚本                │
   └──────────────┬───────────────────────────────────────┘
                  ▼
        Remix Brief 抽取器(Claude, completeWithStructuredTool)
        系统提示核心:"借结构/节奏/卖点,换我方 IP/品牌/角色/画面 —— 差异化,禁复刻"
                  ▼
        产出:differentiated storyboard + Seedance2 prompt + 文案骨架
                  ▼
        Seedance2 generate(text2video 由 prompt;或 image2video/full 带**我方**品牌参照)
        + generate-copy(限字文案)
                  ▼
        Creative(source:'remix', sourceRef=竞品外部id, reviewStatus:'pending')
                  ▼
        ⛔ 人工审核门(creatives/review) ── IP/授权/品牌安全 ── 批准后 ─► 平台推送
```

**核心设计原则 —— "借结构、不复刻"(写死进系统提示 + 审核清单):**

1. **产出永远是我方 IP**:竞品素材只作**分析/参照输入**,**绝不把竞品的版权帧当作我方广告输出**。Seedance2 的参照优先用**我方**品牌素材(image2video/full);若用竞品帧仅作**风格/构图**参照,必须经审核判定"已充分转化"。
2. **借的是结构层**:hook 节奏、卖点顺序、情绪曲线、版式/时长/比例 —— 这些不是版权客体,是可学习的"广告工程"。
3. **人工审核门不可绕过**:复用现有 `reviewStatus:'pending'` → `creatives/review`,把它同时当作 **IP/授权门 + 品牌安全门**。
4. **全程留痕**:每条 `CompetitorCreative` 与每次 Remix 都写 `sourceRef` + `logAudit()`(见 [audit.ts](../../src/lib/audit.ts)),可追溯"这条我方物料参照了哪条竞品"。

***

## 4. 数据模型增量(设计,非落地)

> 遵循 [.claude/rules/schema.md](../../.claude/rules/schema.md):落地时 `npx prisma generate` + `npx prisma migrate dev --name competitor_intel`,并把 migration 一起提交。以下为提案。

**新增** **`CompetitorCreative`**(竞品情报,富元数据):

```prisma
model CompetitorCreative {
  id            String   @id @default(cuid())
  orgId         String
  source        String   @default("appgrowing")   // 取数来源
  externalId    String                            // AppGrowing 素材 id → 幂等键
  // 硬元数据
  appName       String?
  advertiser    String?
  mediaPlatforms Json?                            // ["google_ads","meta",...]
  adFormat      String?
  region        String?
  language      String?
  adDays        Int?                               // 在投天数(长青度代理)
  impressions   BigInt?
  firstSeenAt   DateTime?
  lastSeenAt    DateTime?
  originalPostUrl String?                          // 公开原始出处(YouTube 等)
  ratio         String?
  duration      Int?
  // AI 分析层(来自 AppGrowing,缓存)
  creativeTags     Json?
  sellingPoints    Json?                           // core selling points
  emotionalTriggers Json?
  screenUnderstanding Json?                        // 画面元素
  storyboard    Json?                              // 逐镜
  transcript    String?                            // speech-to-text
  bgm           String?                            // ⚠️ 版权敏感,仅存识别结果不存音频
  aiPrompt      String?                            // AppGrowing 反推的生成 prompt
  rawMeta       Json?                              // 原始响应留档
  // 关联
  assetId       String?                            // 我方 GCS 存的媒体(Asset)
  ingestedAt    DateTime @default(now())
  @@unique([orgId, source, externalId])            // 幂等
  @@index([orgId, appName])
}
```

**新增** **`RemixJob`**(可查询的 Remix 队列 —— 因为现有无 CreativeJob):

```prisma
model RemixJob {
  id                  String   @id @default(cuid())
  orgId               String
  competitorCreativeId String
  briefId             String?                       // 复用 CreativeBrief
  mode                String                        // text2video/image2video/full
  remixPrompt         String                        // 抽取器产出
  status              String   @default("queued")   // queued/generating/ready/failed/rejected
  assetId             String?                        // Seedance2 产物
  creativeId          String?                        // 落地的 Creative
  aiPointsSpent       Int?                           // AppGrowing 点数成本
  createdAt           DateTime @default(now())
  @@index([orgId, status])
}
```

`Creative.source` 增加 `'remix'` 取值;`Asset.source` 增加 `'appgrowing'`。**均为新增,不动既有字段 —— 遵循** **[CLAUDE.md 的"未经询问不删既有代码/模型"](../../CLAUDE.md)**。

***

## 5. 取数策略 —— 三条路,选官方

> 这是整个方案里**唯一需要你拍板**的核心决策(见 §8)。

| 方案                      | 机制                                                                                                                                    | 优点                    | 缺点 / 风险                                              | 结论                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------- | ------------------------------- |
| **A. 官方通道(推荐)**         | (1) 📢 **Ad Creative Skill / API**(若厂商确认可加购)→ 程序化实时取数;否则 (2) 会员套餐内**手工/Collections 导出 + 浏览器插件收集** → 推我方 `POST /api/ingest/competitor` | 合规、稳定、可长期化;人工精选=天然质量门 | Skill 待确认;手工路径有额度(下载/点数);半自动                         | ✅ **主路径**。先手工精选,Skill 确认后升级为自动  |
| **B. 桥接(过渡)**           | 借已登录会话:官方浏览器插件"Collect Videos on Web Pages",或抓 **Original Post 公开 URL**(YouTube 等)→ 推 ingest                                          | 用公开原始出处规避二次分发争议;半自动   | 依赖会话;ToS 边界需读细则                                      | 🟡 **仅作 A 的补充**(尤其"从公开出处再抓一份")  |
| **C. 爬内部 GraphQL(不推荐)** | 用会员 Cookie 直连 `api-appgrowing-global.youcloud.com/graphql`                                                                            | 快、字段全                 | **脆弱**(schema 随时变)· **大概率违反 ToS** · **封号风险** · 无稳定契约 | ⛔ **不作主路径**;至多做一次性 spike 验证字段结构 |

\*\*取数落地(无论 A/B):\*\*统一收敛到一个入口 —— `POST /api/ingest/competitor?org=`(克隆 `ingest/scenes` 的 HMAC + 幂等),body 带一条或多条竞品素材的 `{externalId, 元数据, 媒体URL, AI分析}`;路由内 `fetch(媒体URL) → uploadToGCS → Asset` + `upsert CompetitorCreative`。连接器逻辑封进 `src/lib/platforms/appgrowing.ts`,**把"到底走哪条取数路径"这件事隔离在一个文件里**,上层不感知。

***

## 6. 风险登记册(法务列首位)

| #  | 风险                                                           | 等级    | 缓解                                                                                                                 |
| -- | ------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------ |
| R1 | **第三方/竞品 IP、角色/品牌形象、BGM 音乐版权** 进入我方物料                        | 🔴 最高 | "借结构不复刻"设计;产出=我方 IP;**人工审核门=IP 门**;`sourceRef`+audit 留痕;**Phase 2 推送前先过法务口径**;BGM 仅存识别结果、**绝不把竞品音轨用进产出**           |
| R2 | **AppGrowing ToS**:数据二次分发/自动化抓取限制;下载受套餐门禁                    | 🔴 高  | 官方通道优先(§5-A);尊重套餐额度;**不把爬 GraphQL 当主路径**;读会员协议里 data-reuse 条款                                                      |
| R3 | **成本叠加**:AI Points(月度过期)+ 下载额度 + Seedance2 渲染 + Claude token | 🟠 中  | 优先用**已缓存**的 AI 分析(省点数);**每 org 预算上限**;Remix 变体沿用 Studio 的 `DEFAULT_MAX_VARIANTS=40` 上限;`RemixJob.aiPointsSpent` 记账 |
| R4 | **数据准确性**:AppGrowing 标签是 AI 生成、非真值;Impressions/Ad Days 是估算   | 🟡 中  | 当信号非真理;人工精选;不基于单条数据自动决策                                                                                            |
| R5 | **品牌安全 / 平台政策**:Remix 产出可能 off-brand 或违反投放政策                 | 🟡 中  | 复用 `validateCreative` + `Creative.platformPolicy` + 审核门                                                            |
| R6 | **取数通道稳定性**:内部 GraphQL / 未确认的 Skill 会变                       | 🟡 中  | `appgrowing.ts` 连接器抽象隔离;A 为主、多路径可切                                                                                 |

***

## 7. 分期落地

| 期                             | 目标            | 交付                                                                                                                                                                                                                                                                                             | 依赖                            |
| ----------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Phase 0 —— 手工 PoC(本周,零基建)** | 验证全链路 + 拿法务口径 | 在 AppGrowing 精选 **10\~20 条**本赛道爆款(按 Ad Days/Impressions/Innovative 排序)→ 抄其 AI Prompt / storyboard / 卖点 → 手工填进现有 `/creatives/studio` brief → `produce` → **手工触发 Seedance2** 出 3~5 条差异化变体 → 走 `creatives/review`。**完全复用已建能力,补上** **[04-status.md:26](04-status.md)** **那条 render seam 的第一次真实跑通** | `SEEDANCE2_API_KEY`           |
| **Phase 1 —— 竞品情报库**          | 竞品数据沉淀进 Adex  | `src/lib/platforms/appgrowing.ts` 连接器 · `CompetitorCreative` 模型 + migration · `POST /api/ingest/competitor`(HMAC+幂等) · 媒体入 GCS · `GET /api/competitors` 列表/筛选 · 一个只读竞品面板                                                                                                                       | §5 取数决策                       |
| **Phase 2 —— Remix 引擎**       | 竞品→我方物料自动化    | `POST /api/creatives/remix` · Claude Remix-brief 抽取器(`completeWithStructuredTool` + "差异化禁复刻"系统提示) · 接 Seedance2 生成 + generate-copy · `RemixJob` 模型 · 落 `Creative(source:'remix', reviewStatus:'pending')`。**正式补完 render seam 的竞品这一路**                                                          | Phase 1 + **法务 sign-off(R1)** |
| **Phase 3 —— 自动化 + 情报**       | 常态化运营         | `POST /api/cron/competitor-sync`(克隆 review-sync,每日拉精选 Collection) · 竞品趋势看板(哪些卖点/hook 按 Ad Days/Impressions 在赢) · 每 org 预算上限 + 完整 audit · 若确认 **AppGrowing Skill/API** 则升级取数为全自动                                                                                                                | Skill 确认(可选)                  |

***

## 8. 需要你拍板的开放决策

1. **取数通道(§5)**:是否**联系 AppGrowing 销售确认 "Ad Creative Skill"/API 是否可用、是否在套餐内/需加购、是否给 key 或 MCP endpoint**?这决定 Phase 1/3 是全自动还是手工精选起步。(我方建议:先手工精选 + 并行去问销售。)
2. **法务口径(R1)**:Phase 2 把 Remix 产物**推上平台之前**,是否需要先过一次法务对"借结构不复刻 + 人工审核门"的书面认可?(强烈建议:需要。)
3. **先库还是先 Remix**:先做**竞品情报库**(独立有价值、风险低)再做 Remix,还是并行?(建议:Phase 0 手工 PoC 立刻做,Phase 1 库先行。)
4. **种子范围**:先聚焦哪个**赛道/竞品/区域**?(账号当前锁定 Game / US / 某 appBrand —— 是否就以此为首个种子?)
5. **AI Points 预算**:32,000 点(2,000 本月过期)——是否先用**将过期的 2,000 点**跑 Phase 0 的抽取(AI Prompt×3 点、Storyboard×10 点),把额度花在刀刃上?

***

## 附:一句话结论

\*\*下游已备好 90%(Studio + Seedance2 + ingest + 审核门),缺的正是竞品这路的取数 + 一个"借结构不复刻"的 Remix 抽取器。\*\*建议本周先用将过期的点数跑一遍零基建手工 PoC 打通全链路、同时并行确认官方取数通道与法务口径,再按 库→引擎→自动化 三期推进。
