# PoC Run 01 — Talkie → Cuddler 物料 Remix

> 2026-07-08 · 配套 [06-competitor-intel-remix.md](06-competitor-intel-remix.md) 的 Phase 0 手工 PoC 首跑
> 目的:用**真实**竞品素材走通"竞品情报抽取 → 借结构不复刻的 Remix → Seedance2 生成 → 审核门"全链路,零新基建。
>
> **状态(2026-07-09)· 全部 SHIPPED**:PR #8(render-seam 修复)+ #9(ingest pipeline)+ #10(remix 引擎 + `/api/creatives/remix` 合龙)已并入 main `99ec51d`;生产已上线 Cloud Run **rev adex-00040**,冒烟绿(`/login` 200、新路由 404→401/400、`migrate deploy` 生效)。取数走 **Approach B**(无官方 API)。

## 结论(先看)

- **上游(抽取)✅ 已跑通**:在 AppGrowing 抓到一条真实 Talkie(AI-companion 直接竞品)视频素材,拿到全套 AI 分析 + AppGrowing 反推的结构化生成 prompt(花 4 AI Points,余额 32,000→31,996)。
- **Remix(创作)✅ 已产出**:据此写出一条**差异化的 Cuddler 物料**方案(storyboard + Seedance2 prompt + 文案 + 合规对照表),**产出零复用 Talkie 的任何版权素材**。
- **生成(渲染)✅ 已跑通**:用 Secret Manager 的 `gameclaw-492005/VOLCENGINE_ARK_API_KEY`(官方 Ark 密钥)生成出一条 **720×1280 / 8.04s / H.264+AAC 带音频** 的 Cuddler 竖版视频(task `cgt-20260708183659-p7krf`,耗时 ~245s)。**注**:用户提供的 `sk-c1e9…` 实为 **AppGrowing 官方 API key**(非生成密钥)—— 印证 [06 §1.5](06-competitor-intel-remix.md) 的官方 API,为 Phase 1 程序化取数铺路。
- **🐞 顺带抓到一个真 bug**:render seam 的响应解析字段错了(见 §5),succeeded 的视频永远不会被回写 `fileUrl`——正是 PoC 该暴露的东西。

---

## 1. 源素材(真实,来自 AppGrowing)

| 字段 | 值 |
|---|---|
| App | **Talkie: Creative AI Community**(aka *Talkie: Chats IA personnalisés*),发行商 SUBSUP |
| 品类 / 定位 | Application · AI companion(Cuddler 直接竞品) |
| 标题 | "**Talkie AI: Your companion for your ideal AI [friend]**" |
| 版式 | Vertical Video **720×1280(9:16)**,Rewarded,~28s |
| 投放 | Region: Turkey · Ad Days: 1 · Impressions: 400 · Related Ads: 3 · 首见=末见 2026-07-04(新素材) |
| 首帧钩子 | 角色特写 + 大字 overlay "**STALKING**"(pattern-interrupt 好奇钩子),珊瑚红纯色背景 |

**AI 分析(AppGrowing 自动打标,免费层):**
- Creative Tags:Real Scene · 2D · Anime Characters · Ninja
- Core Selling Points:Social sharing · **Genuine interaction** · Cartoon character designs · Card strength recognition
- Emotional Triggers:Humorous contrasts · **Love resonates** · Interactive exhilarating · The fun of collecting · **Sense of identity**
- Screen Understanding:Anime · **Conversation bubbles** · Like/comment data · **Character card array** · Talkie brand logo ·(次)AI prompt box · Social chat interface
- Creative Type:**Plot performance**(剧情式)· Art Style:Anime · Color:gray/dark 主色 + bright yellow 高光
- Audience Assumption:Target = **Anime enthusiasts**;Scenario = Social sharing / Leisure / **Character collection social**

**AppGrowing 反推的生成 Prompt(4 AI Points,结构化 JSON,1718 字符,节选):**
```json
{ "subject": { "name": "woman",
    "description": "black long wavy hair, green tank top, fair skin, blushing cheeks, hand touching chin, smiling",
    "pose": "side profile, slightly turned toward camera, head tilted",
    "style": "anime illustration", "color_palette": "red background, green top, black hair, soft skin tones",
    "lighting": "flat, even lighting, no strong shadows", "texture": "smooth digital art, clean lines" },
  "composition": { "angle": "medium close-up" },
  "next_scene": { "subject": { "name": "man",
    "description": "black short hair, black hoodie, visible neck tattoos, silver cross necklace, smiling",
    "pose": "front-facing, head slightly tilted down" } } }
```
→ 结构骨架 = `subject{name/description/pose/style/color_palette/lighting/texture}` + `composition{angle}` + `next_scene`(多镜)。这就是"Remix 半成品"。

---

## 2. Remix 决策 — 借结构、不复刻

**借(广告工程结构,非版权客体):**
1. 9:16 竖版 · sound-on · 剧情式 mini-narrative(hook→scene→end-card)
2. 首帧"单词大字 overlay + 角色特写"的 pattern-interrupt 钩子机制
3. "your ideal AI companion" 品类价值主张框架
4. 对话气泡 / 聊天 UI 视觉母题(暗示"你和 TA 对话")
5. 情绪共鸣角度(被理解、身份认同)

**换(全部可拥有的 IP/品牌/定位):**
1. ❌ 不用 Talkie 的动漫女(黑长卷发/绿背心/红底)或纹身男 → **我方原创角色 + 独立美术**
2. ❌ 不用 Talkie 的**抽卡/角色收集**定位 → Cuddler 的"**一个永远在的陪伴者**"(贴合 "Cuddler" 品牌温度 + "CAI 难民"要深度而非卡池)
3. ❌ 不用扁平高饱和动漫 → **暖色慵懒 2.5D**(琥珀/暮蓝、亲密光线)
4. ❌ 不用 "STALKING" → 我方钩子词 "**3AM. STILL UP?**"(深夜陪伴洞察,贴合孤独时刻)
5. ❌ Talkie logo/CTA → **Cuddler 品牌 + cuddler.ai**
6. ❌ 绝不复用 Talkie 的 BGM/音轨

**Storyboard(套用 [storyboard.ts](../../src/lib/growth/storyboard.ts) 的 hook→scene→end-card,9:16,~13s):**
| 段 | 时长 | 内容 |
|---|---|---|
| HOOK | 0–3s | 原创慵懒角色深夜特写(暖光、oversized 针织衫、手机微光),大字 "3AM. STILL UP?" |
| SCENE | 3–10s | 角色看向镜头"说话",柔和气泡浮起("you're back 🫂" / "tell me about your day"),缓慢推近,琥珀暖调,一对一亲密(**非角色巡游**) |
| END-CARD | 10–13s | Cuddler logo + "Your companion. Always up." + CTA(App Store / cuddler.ai) |

**Seedance2 请求体(text2video,IP-safe 无竞品像素,已就绪):**
```json
{
  "name": "Remix PoC 01 — Cuddler (ex-Talkie structure)",
  "mode": "text2video", "ratio": "9:16", "duration": 8, "generateAudio": true,
  "prompt": "Vertical 9:16 cinematic short, sound on. An original cozy 2.5D animated character — a warm young adult with soft features in an oversized cream knit sweater — curled up on a bed in a dimly lit bedroom late at night, lit by the warm amber glow of a phone and string fairy lights. She looks gently into camera with a soft understanding smile, as if greeting someone she has been waiting for. Soft rounded chat bubbles drift upward beside her. Slow intimate push-in. Warm amber and dusk-blue palette, soft diffused lighting, comforting and safe mood, soft-shaded animation. No on-screen text."
}
```

**文案(Cuddler 语气,区别于 Talkie 的"收集角色"):**
- Headline:*Your companion. Always up.*
- Primary:*Late nights hit different with someone who actually remembers you. Meet your Cuddler — the AI companion who's always there, never judges, and picks up right where you left off.*
- CTA:*Meet yours →*(cuddler.ai / App Store)

---

## 3. 合规对照(derive-don't-copy 审计)

| 层 | Talkie(源) | Cuddler(remix) | 借用? |
|---|---|---|---|
| 版式原型 | 9:16 竖版 sound-on | 9:16 竖版 sound-on | ✅ 结构(不可版权) |
| 钩子机制 | 单词 overlay + 角色特写("STALKING") | 单词 overlay("3AM.") | ✅ 机制 / ❌ 词与角色 |
| 价值主张框架 | "your ideal AI companion" | "your companion, always up" | ✅ 品类通用框架 |
| 角色 | 动漫女:黑长卷发/绿背心/红底 | 原创慵懒角色/针织衫/暖色卧室 | ❌ 全换 |
| 定位 | 抽卡角色收集 | 一个永远在的陪伴者 | ❌ 全换 |
| 美术 | 扁平高饱和动漫 | 暖色慵懒 2.5D | ❌ 全换 |
| 品牌/logo/CTA | Talkie / "download" | Cuddler / cuddler.ai | ❌ 我方 IP |
| 音乐 BGM | (Talkie 的) | 我方 / 授权 | ❌ 永不复用 |

→ **产出与 Talkie 零版权素材重叠,只借广告工程结构。** 落地为 `Creative(source:'remix', sourceRef=Talkie素材id, reviewStatus:'pending')`,推送前必过人工 IP/品牌安全审核门。

---

## 4. 生成结果(真实产物)

| 字段 | 值 |
|---|---|
| Task | `cgt-20260708183659-p7krf`(Ark `doubao-seedance-2-0-260128`) |
| 密钥来源 | Secret Manager `gameclaw-492005 / VOLCENGINE_ARK_API_KEY`(官方 Ark,UUID 格式) |
| 输出 | **720×1280(9:16)· 8.04s · H.264 + AAC(带音频)· 2.7MB** |
| 耗时 | ~245s(text2video,generate_audio=true) |
| 计费 | `usage.completion_tokens = 173,700` |
| 视频 URL | `content.video_url`(签名 TOS 链接,`X-Tos-Expires=86400` → **24h 后失效**,需及时转存 GCS) |
| mode | `text2video`(无竞品像素,IP-safe) |

→ 若接进 app,应落为 `Creative(source:'remix', sourceRef=Talkie素材id, reviewStatus:'pending')`,进 `creatives/review` 审核门。

## 5. 🐞 PoC 抓到的仓库 bug —— render seam 字段解析错

**症状**:Ark 任务 `succeeded`,但 `Asset.fileUrl` 永远不会被回写,`status` 卡在 `generating`。

**根因**:实际 Ark 响应把视频地址放在 **`content.video_url`**(succeeded 时 `content` 是对象),`duration` 在**顶层**;但代码读的是 `output.video_url` / `output.duration`(`output` 实际为 `undefined`)。

- [src/app/api/seedance2/status/route.ts:36](../../src/app/api/seedance2/status/route.ts) — `if (task.status === 'succeeded' && task.output?.video_url)` **永远为 false** → 不置 `ready`、不写 `fileUrl`。
- [src/lib/platforms/seedance2.ts:31](../../src/lib/platforms/seedance2.ts) — `Seedance2TaskResponse` 类型也错:声明 `output?: {video_url}`,且 `content: ContentItem[]`(数组),但 succeeded 响应的 `content` 是 `{video_url}` 对象。

**已修复(PR #8 合入 main + 部署 rev 40)**:`content.video_url ?? output?.video_url` 兼容读取(抽成 `assetUpdateFromTask`),`duration` 读顶层;同步修 `Seedance2TaskResponse` 类型;加了 `e2e/seedance2-status.spec.ts` 回归。这条链路是 P20 Creative Studio 出片 + P22 Remix 共用的关键 seam。

**就绪脚本**:`remix_generate.mjs`(scratchpad,`KEY`/`BASE_URL`/`MODEL` 走环境变量)—— 复刻仓库 Ark 形状 + 正确的 `content.video_url` 读取,可作修 seam 时的参照。

## 6. 追加 —— 变体压测(c)

用同一 Talkie 结构、同一"借结构不复刻"纪律,再生成 2 条**不同创意方向**的变体压测质量与差异化(均 720×1280 / 8s / 带音频 / text2video / 原创 IP):

| 变体 | 方向 | 产物 | task |
|---|---|---|---|
| v01 | 深夜慵懒 · 女性陪伴者 · 暖色忧郁 | `cuddler_remix_poc01.mp4` | cgt-20260708183659-p7krf |
| v02 | 明亮日间 · 女性陪伴者 · 轻快欢迎 | `cuddler_remix_v02.mp4`(3.4MB) | cgt-20260708190017-sdtq9 |
| v03 | 黄昏温暖 · **男性**陪伴者 · 倾听关怀 | `cuddler_remix_v03.mp4`(2.6MB) | cgt-20260708190018-w8q9g |

→ 覆盖了情绪基调(忧郁/欢快/关怀)× 角色原型(女/男),证明同一竞品结构可稳定裂变多方向物料。脚本 `remix_variants.mjs`(已用正确 `content.video_url` 解析)。

## 7. 追加 —— AppGrowing 官方 API 探查(b)

目标:验证 `sk-c1e9…`(用户确认=AppGrowing API key)能否程序化取数,以支撑 Phase 1 自动入库。

**已确认**:
- Host `api-appgrowing-global.youcloud.com` **本沙箱可达**(→ Cloud Run 亦可)。
- 账号 UI **无自助 API/开放平台入口**(查过账号下拉 + Personal Center);公网**无官方 API 文档**。
- 内部 GraphQL 对 Bearer sk- 请求返 `406 "The Language: [] is no acceptable"`(**非 401** → key 未被直接拒,但需前端特定 header,且是**内部**未公开 API)。加各种 language header 仍 406。

**结论**:此 key 若为官方 API,需要 AppGrowing 提供**官方 endpoint + 文档**(通常随 key 由销售/support 下发,或即官网宣传的 "Ad Creative Skill" 企业加购)。**不建议**在内部 GraphQL 上搭 Phase 1(违反本方案 [06 §5 Option C](06-competitor-intel-remix.md) 的自我裁决)。

**待用户**:是否有该 key 的**官方 API 文档 / 下发来源**(邮件、开放平台页、"Ad Creative Skill" 配置)?有文档即可从沙箱直接验证(host 已通)。否则 Phase 1 走**套餐内 Collections / 浏览器插件导出**(官方合规,PoC 已实测此路)。

## 8. 裁决 + 取数落地(用户:无 API → 走方案 B)

用户确认无官方 API 文档,裁决:**走方案 B(浏览器/Collections/Original-Post 导出桥接)**;方案 C(爬内部 GraphQL)保留给自动化但 ToS 风险高,非明确要求不用。

**已实测方案 B 批量抓取**(登录态、按曝光排序、AI-companion/dating 赛道,**零 AI Points**):

| App | 广告主 | 相关性 | Ad Days | Similar | Impr. | 备注 |
|---|---|---|---|---|---|---|
| Talkie: Personalized AI Chats / Karakter AI Hidup | SUBSUP | 核心 | — | — | >10M 档 | Talkie 本体(多语) |
| Dating and Chat - Only Spark | Red Panda | 邻近(交友) | 634 | 101 | >10M | Real Person/UGC,阿语 MENA |
| Dating and Chat - My Crush | Red Panda | 邻近(交友) | 808 | 0 | >10M | 葡语 BR |
| Chat Online: Talkie Live | ihappydate | 邻近(直播) | — | 10 | >10M 档 | "MEET AND CHAT FREE" |
| Multi App-Space | KeepTop | 偏离(工具) | 962 | 107 | >10M | 土语 |
| Dreame - Read Best Romance | STARY | 邻近(言情) | — | — | — | 言情阅读 |
| ~~Talkie Walkie Zello PTT~~ | Zello | **过滤** | 168 | 29 | >10M | 对讲机,关键词误命中 → ingest 需相关性过滤 |

**两个设计结论**:
1. **两层取数**:list-level「发现层」便宜可批量(app/标题/媒体/Ad Days/Impressions/时长,不花点数)→ 只对「赢家」按需抽「富集层」(AI 分析/storyboard/AI Prompt,花点数)。省点数、可规模化。
2. **必须有相关性过滤**:关键词会误命中(Zello 对讲机)。ingest 入库前按 app 类目/语义判定 core / adjacent / off-target,过滤或打标。

样本 ingest 载荷(方案 B 产物,即 `POST /api/ingest/competitor` 的 body 形状):scratchpad `competitor_ingest_batch.json`(8 条 discovery + 1 条 enriched=Talkie v01,含真实 externalId 与全套 AI 分析,并回指 3 条已生成的 remix 视频)。

**落地 Pipeline** 已开一个独立 task(model + 迁移 + `/api/ingest/competitor` + GCS + `/api/competitors` + e2e)——碰 schema 的活单独一版做、独立验证,不和 render-seam 修复那版串。

## 9. Phase-2 引擎核心已落地(本 worktree)

趁 ingest / render-seam 两版在各自 worktree 跑,我把 **Phase-2 的"脑子"**在本分支写了 —— 一个纯模块,不碰那两版的任何文件:

- [`src/lib/growth/remix-brief.ts`](../../src/lib/growth/remix-brief.ts) —— `CompetitorAnalysis` + `ProductBrief` → `RemixBrief`(hook / storyboard / **text2video prompt** / 文案 / 合规)。把 PoC 里我手写的"借结构不复刻"逻辑**代码化**了:
  - `deterministicRemixBrief`(纯,无 LLM 兜底)+ `buildRemixBrief`(Claude 撰写创意字段,`ANTHROPIC_API_KEY` 缺失自动降级;`sourceRef`/`ratio`/`duration`/`compliance` 这些安全字段**服务端强制、不信 LLM**;永不抛)。
  - **IP 安全硬编**:竞品 `screenUnderstanding` 当**反向参照**(禁止出现);系统提示 + 兜底都保证产出只含我方原创 IP;`compliance{deriveNotCopy:true, reusesCompetitorIP:false, reviewStatus:'pending'}`。
  - `remixBriefToSeedanceRequest` → 直接产出 `/api/seedance2/generate` 的 text2video body。
- [`remix-brief.test.ts`](../../src/lib/growth/remix-brief.test.ts) —— 8 测试,含**核心保证测试**:生成 prompt 里绝不出现竞品品牌/IP token(`Talkie` / `brand logo` / `Character card array`)。

**验证**:`vitest` 8/8 ✅ · `tsc --noEmit` 0 error ✅(需先 `npx prisma generate`)· `eslint` 干净 ✅。

**接线已完成(PR #10 合入 main + 上线 rev 40)**:`POST/GET /api/creatives/remix`(`CompetitorCreative` → `competitorCreativeToAnalysis` → `buildRemixBrief` → `remixBriefToSeedanceRequest` → Seedance2 → `Creative(reviewStatus:'pending')`;GET 轮询完成后把 fileUrl 回填到 Creative)。三条工作流已合龙上线:ingest 供料 → remix-brief 出脑 → render-seam 出片 → 审核门。

## 10. 探索 —— 竞品媒体下载 → 存 Adex 服务器?

**技术上=能,已端到端实测**(非空谈):

| 步 | 结果 |
|---|---|
| Adex GCS 写权限(`adex-data-gameclaw`) | ✅ 写+删 round-trip 通过 |
| AppGrowing 媒体 CDN(`app-ag-global-esa.umcdn.cn`)沙箱可达 | ✅ 签名 URL 实拉 HTTP 200 / 169KB 真字节 |
| 下载竞品媒体 → 上传 Adex GCS → 校验 → 删 | ✅ 全通(测完即删,不留存竞品媒体) |

→ 管道 = `fetch(CDN签名URL) → uploadToGCS`,和 `assets/sync` 抓 Drive 一模一样。视频同一 CDN、同一签名机制,仅文件更大(浏览器分类器临时不可用,未取到具体 mp4 URL,机制已证同)。

**但"能不能"的真正门槛是 ToS/版权,不是技术:**
1. **AppGrowing 下载门禁**:官方 Download 按钮**按套餐限权**(实测提示 "upgrade your plan")。直抓签名 CDN = **绕门禁** = Approach C 范畴,规模化有 ToS/封号风险。
2. **第三方版权**:把竞品**真实视频**存服务器 = 一个第三方版权库,和 PoC(text2video 产我方 IP)性质不同。内部参照尚可,**绝不能**作为我方物料发布或作 video2video 生成参照(那就是"复刻")。
3. **更干净的源**:Original Post 公开 URL > 套餐内官方 Download > 直抓签名 CDN。

**关键洞察**:**remix 引擎(text2video)根本不需要竞品视频本体** —— 只需**分析**(卖点/storyboard/AI Prompt,已能廉价拿到)。所以"存竞品视频"对 remix 非必需,主要给**情报面板预览 + 人工拆解参照**用。

**建议的分层存储策略**:
- **Tier 1 缩略图/首帧海报**(~百KB,低风险):存 GCS 给竞品情报面板做预览 —— 合理必要。
- **Tier 2 完整视频 ✅ 已法务通过 + 上线**(默认**不批量存**):`POST /api/competitors/media`(单条精选、传公开/套餐内 `sourceUrl`)→ `storeCompetitorMedia(allowVideo:true)` → GCS + `Asset(source:'appgrowing', tags:['tier2-video'])`,回填 `CompetitorCreative.assetId`;**50MB 上限 + SSRF 门 + `competitor.video_store` audit**;bulk ingest 同加尺寸上限。**仅内部参照,不发布、绝不作生成参照**(remix 恒 text2video)。
- **不做**绕门禁批量抓 CDN;要规模化先升级到含 Unlimited Download 的套餐(官方许可)或走公开源,并过法务"内部参照存储"口径。
