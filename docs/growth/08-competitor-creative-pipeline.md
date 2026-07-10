# 竞品素材生产工艺层 (Competitor Creative Pipeline — 工艺层)

> Version v1 · 2026-07-09 · 定位:[07-competitor-intel-remix.md](07-competitor-intel-remix.md)(P22,系统层:取数/数据模型/法务/分期)的**配套生产工艺**——素材拿到手之后"怎么拆、怎么分级、用什么工具做出来、怎么质检"。
> 已确认:新产品 = **Cuddler**;取数走 07 §5-B 桥接(过渡),不爬 GraphQL;销售/法务侧无阻塞;Phase 1 工艺脚本**独立目录起步**、稳定后并入 adex。
> 方法论来源:Hakko 主 SOP(`/Users/mt/work/project/Hakko/文案&脚本&视频制作-Hakko/00_文档/广告视频产出流程与优化总结-Hakko.md`)与 Luddi 主 SOP(`/Users/mt/work/project/Luddi/文案&脚本&视频制作/文档/广告视频产出流程与优化总结.md`)。

## 0. 目标与成功标准

**目标**:把 AppGrowing 拉到的竞品/同品类广告素材,经"拆解 → 分级 → 路由到不同生产工具",稳定产出 Cuddler 可投放的广告素材。

**成功标准**(v1 验收):

1. 任一批竞品素材进入流水线后,自动产出分析产物 + 分级路由建议,无需手工跑命令。
2. 每条产出素材过完红线质检 + 人工审核门才可标记"可投"。
3. 首批产出 ≥10 条 IP-洁净素材(对应 [05-cuddler-playbook.md](05-cuddler-playbook.md) §0 门禁"10–14 条官方自制 IP-洁净素材")。
4. 全链路产物落在统一目录/命名约定下,台账(manifest)可追溯每条成片的竞品来源与改造方式(与 07 §3.2 的 `sourceRef` + audit 留痕同构)。

## 1. 总览

```text
① 采集入库          ② 拆解分析            ③ 分类分级             ④ 生产               ⑤ 质检→投放
AppGrowing 素材 ──► 双分析层 ──────► L1–L4 × 素材类型 ──► 按路由调工具 ──► 红线QC → adex审核门
（07 §5 官方通道）  （AppGrowing AI 分析   （LLM建议+人工抽检）   （分级见 §4）      → DCO变体矩阵 → push
                     + 本地四件套）
```

五段中 ①② 全自动,③ LLM 给建议 + 人批量确认,④ 按级别自动化程度不同,⑤ 脚本预检 + 人工终审(IP/授权门永远人审,与 [05-cuddler-playbook.md](05-cuddler-playbook.md) §3 及 07 §3.2 原则四一致)。

## 2. ① 采集入库 (Ingest)

- **取数通道**:按 07 §5 决议(2026-07-09)走 **B. 桥接(过渡)**——借已登录会话,用官方浏览器插件 "Collect Videos on Web Pages" 收集,或抓 Original Post 公开出处(YouTube 等);**不爬内部 GraphQL**。半自动:人负责收集,落盘/推送后脚本接管。统一入口 `POST /api/ingest/competitor`(Phase 1 落地,克隆 `ingest/scenes` 的 HMAC + 幂等);Phase 0 手工阶段先"批量文件夹落盘 + manifest.csv"。
- **优先级**:AppGrowing 的 **Ad Days(在投天数)/ Impressions / Innovative 标记**是免费的"已验证信号"——投得久、量级大的先进队列;这也决定哪些素材值得花 AI Points 做深度抽取(见 §3)。
- **编目**:沿用 Hakko/Luddi 已验证的约定——源素材加 `已盘点_` 前缀 + `manifest.csv`,记录:竞品名、投放渠道、AppGrowing 指标(Ad Days/Impressions)、externalId(对齐 07 §4 `CompetitorCreative` 幂等键)、格式、时长、分辨率。
- **去重**:同一竞品多渠道重复投放的素材按内容指纹(时长+抽帧 phash)合并;AppGrowing 侧已有 Deduplication Statistics 可先用。

## 3. ② 拆解分析 (Analyze) — 双分析层

**先用 AppGrowing 已有的 AI 分析,本地四件套做它做不了的事**(07 §2.4 的建议:零改造且省点数):

**A 层 — AppGrowing 情报层**(随素材入库,存 `CompetitorCreative` 对应字段):

| 产物 | 来源 | 计费 |
| --- | --- | --- |
| 卖点/情绪触发/画面理解/Creative Tags | Creative Overview | 通常已缓存,免费 |
| 反推生成 prompt(Remix 半成品) | AI Prompt | 3 AI Points/次 |
| 逐镜 storyboard | Video Split | 10 AI Points/次 |
| 口播逐字转写 | Speech to Text | 计点 |

点数纪律:只对**过了优先级筛选(§2)且分级为 L3/L4 候选**的素材花点;优先消耗将过期点数(07 §8-5)。

**B 层 — 本地四件套**(对已下载媒体跑,AppGrowing 给不了的):

| 产物 | 工具 | 用途 |
| --- | --- | --- |
| `metadata.csv` | ffprobe | 规格台账(Luddi 路径C) |
| 关键帧拼图(0.3s/2s/5s/中段/尾帧) | ffmpeg 抽帧 | 视觉筛选(Hakko §0) |
| `transcript.csv` 声轨转写 | whisper-cli(`ggml-base.en`/多语言 `small`) | **品牌名/slogan 声轨定位**(Hakko §0 前置听查)+ 校验 AppGrowing 转写 |
| `ocr_frames.csv` 品牌露出扫描 | tesseract 抽帧 OCR | **delogo 坐标定位**(L1/L2 必需)+ QC 复扫 |

B 层同时承担对 A 层的**真值校验**——AppGrowing 标签是 AI 估算(07 风险 R4),关键判断(品牌露出、分级)以本地扫描为准。这些命令目前在 Hakko/Luddi 是手工跑的,本流水线第一优先固化成脚本。

## 4. ③ 分类分级 (Classify & Route) — 核心决策表

两个轴:**改造深度 L1–L4**(决定工具、成本与 IP 风险)×**素材类型**(决定具体管线)。判据继承 Hakko §0 决策图 + Luddi C1–C8 分类。

### 4.1 改造深度分级

| 级别 | 判据 | 做法 | 主工具 | 单条成本/速度 | IP 洁净度 |
| --- | --- | --- | --- | --- | --- |
| **L1 轻改造** | 成片主体可用,品牌露出仅 logo/尾帧/固定文案(Hakko 路径A / Luddi C1–C3) | 剪尾、delogo、遮标、换尾帧 | ffmpeg 模板(Hakko §12 三套 + Luddi `process_pathC.sh`) | 分钟级,最便宜 | 🔴 低(画面仍是竞品的) |
| **L2 重组混剪** | 有 2–8s 高价值片段但整体不能直接用(Hakko 路径B) | 抽片段重组 + 重配字幕/VO/BGM + 自有素材穿插 | ffmpeg + Luddi `build.py` 混音管线 + ElevenLabs v3 | 小时级 | 🟠 中(仍含竞品片段) |
| **L3 复刻重制** | 素材"结构值钱、画面不能用",hook-节奏-叙事已被投放验证 | 拆分镜 → Seedance2 逐镜生成 + 自有产品录屏/UI 替换 → 重组 | Seedance2(seedance2-skill prompt 方法;AppGrowing AI Prompt 作底稿)+ OpenMontage 参考复刻模式 + adex `storyboard.ts` | 小时~天级 | ✅ 高(借结构不复刻) |
| **L4 灵感入库** | 只提炼角度:hook 文案、卖点、人设、开场模式 | 进 hooks/angles 库 → 走 Creative Studio brief 全新生成 | adex `POST /api/creatives/studio`;口播类用 video-use,通用用 OpenMontage/Seedance2 | 与常规自制相同 | ✅ 最高 |

**Cuddler 主线 = L3/L4**,即 07 §3.2 的 Remix 引擎("借结构、不复刻"):

- pilot 门禁要求 IP-洁净素材,且 07 已把"物料含第三方/竞品 IP"定性为独立法律层级(R1 最高风险)——**L1/L2 产物对 Cuddler 默认不投放**。
- L1/L2 是 Hakko/Luddi 存量业务已在用的工艺,脚本固化后两边直接受益;对 Cuddler 仅当法务口径(07 §8-2)明确允许后,才可用于小额探针验证 hook,验证过的结构仍升级为 L3 重制。
- **强制降级**(不可被"素材很好"覆盖):含第三方 IP 角色/名人形象 → 最高 L3(画面必须重制);竞品名贯穿画面或声轨且剪不掉(Hakko"放弃"路径)→ L4。
- **真人出镜单独判定,不是降级理由**(2026-07-10 按一线经验修正):真人+无品牌露出+通用 hook/网络梗 → 可直接按 L1/L2 复用;`has_real_face` 影响的是生成阶段输入方式(Seedance 拦截写实真人脸参照,L3 时只能文字化结构走 text2video),不影响复用分级。核心判断轴是**品牌露出位置**:尾帧/固定 logo → L1 好处理;贯穿主体(画面中段/声轨口播)才是难点,按可救程度分流 L2/L3/L4。
- **分段路由 segment_plan**(2026-07-10 增补):整条分级之下再按时间段细化执行计划——干净且有价值的段(尤其真人梗 hook)标 `reuse` 直接复用原片,品牌贯穿的段标 `remake` 走重制,纯品牌尾帧段标 `drop` 换 Cuddler 尾帧。混合体素材(梗 hook + 品牌主体)由此实现"hook 原样复用 + 主体 AI 重制 + 拼接"——梗的价值在原片本身,严禁 AI 重生成梗段。生成 prompt 只覆盖 remake 段;拼装由 assemble.py 统一(reuse 实切 + 生成段 + 尾帧插槽,1080×1920 归一,段间 30ms 音频淡变)。

### 4.2 素材类型 → 生产管线路由

| 素材类型 | L3/L4 的生成管线 |
| --- | --- |
| 口播/talking-head | 脚本(转写作参照)→(真人拍 or AI 数字人)→ **video-use** 剪辑(去语气词/字幕/调色)+ ElevenLabs VO |
| 短剧/情绪/POV | 分镜(AppGrowing storyboard 作底)→ **Seedance2** text2video/image2video 逐镜生成 → 拼接混音 |
| 产品功能演示 | 自有录屏管线(Luddi `自动化游戏录屏_pipeline` 模式,适配 Cuddler UI/场景)+ 字幕/VO |
| 混剪 montage | 自有素材池 + `beat_detect.py` 卡点 + build.py 族 |
| 图文/静态 | Seedream 生图 + 文案(Creative Studio `generate-copy` 已有) |

### 4.3 良率机制（2026-07-10 增补，方法来源:OpenMontage / video-use / seedance2-skill 调研）

分析与生成的方法栈:

- **结构拆解 schema**:借 OpenMontage `video-reference-analyst` 的 **5-aspect 逐镜拆解**(主体/动作/场景+文字层单列/景别构图/运镜,不适用字段显式 N/A)+ motion_type 判定(真运动/静图动画/静帧)——这是"借结构不复刻"的结构化载体,分级精排和 remix brief 都基于它。
- **生成 prompt 模板**:seedance-prompting 的 8 组件结构 + 跨镜身份锚点逐字重复 × seedance2-skill 的 @引用语法(每个引用声明用途)+ 分时段描述(>8s 必用)。
- **硬约束进路由**:Seedance2 参考视频 ≤3 个/总时长 2-15s(竞品素材先按分镜切片);**写实真人脸素材被模型拦截**——含真人脸的素材禁用视频参照,只能文字化结构走 text2video(分级器输出 has_real_face 维度);输出上限 720p,成片需补放大工序到 1080×1920。

良率闸门(按成本从低到高,前一道不过不进下一道):

1. **prompt lint**(静态免费):引用有用途声明、无冲突运镜、单镜 ≤3 动作、有音频设计、生成内不放可读文字/logo(文字层走后期 overlay)、时长与复杂度匹配。
2. **storyboard 多样性检查**:景别多样性、静态镜占比、废话词——防"每条长一样/幻灯片感"(借 variation_checker 思路)。
3. **sample-first 门禁**(OpenMontage Step 5,强制):先只生成 **hook 首镜 + 卖点核心镜** 两条 clip 过审,风格/结构确认后再铺全片——用最小成本提前抓风格错配。
4. **成片 qc**:品牌词声轨/OCR 复扫(§6,已含 ASR 变体)。

竖版规范(进 brief 模板,来源 OpenMontage short-form.md):hook 前 1-2s pattern interrupt、每 1-3s 换画面、底部 300-320px 平台 UI 死区不放重点、15s 档完播率最优。口播线复用 video-use 的转写→文本决策→EDL→渲染主干与现成竖版适配(字幕安全区 MarginV=90、-14 LUFS、HDR→SDR),自建它缺的 hook 前 3s 校验与 CTA 尾帧原语。

## 5. ④ 生产 (Produce) — 统一收尾

无论哪条路由,收尾统一(Hakko §13 / Luddi A/B 收尾合并):

```text
字幕 → ElevenLabs eleven_v3 VO（情绪 tags）→ BGM/SFX（ElevenLabs Music/SFX，绝不用竞品音轨）
→ 混音 amix/sidechain + loudnorm I=-14:TP=-1.0（VO 1.0 / BGM 0.12–0.15 / SFX 0.2–0.3）
→ [尾帧插槽] + [logo插槽] → libx264 crf18 + aac 192k + faststart，1080×1920 (9:16)
```

- **尾帧/logo 为插槽 (slot)**:Cuddler 品牌资产未到位前,流水线先跑通、产物停在"待尾帧"状态;资产给到后批量补渲染(IAB DCO swappable slot 思路,与 Creative Studio 同构)。
- API key 一律运行时 `hakko-secret <name>` 获取,不落盘。
- 命名沿用 Luddi 约定:`来源级别_日期_类型_内容_9x16.mp4` + 质量标签 `A_强推荐/B_可用/C_备用/X_不要用`。

## 6. ⑤ 质检与投放接入 (QC → adex)

1. **脚本预检**:whisper 复扫(竞品名/slogan 残留)、tesseract 复扫(logo/水印残留)、delogo 前中尾 2x 局部对比图(Luddi 质检规范)、ffprobe 规格校验。
2. **红线清单**:Hakko R1–R10 移植为 checklist(声轨前置确认、能剪先剪、delogo 边距≥4、复评不得增加品牌色块等)+ 内容红线(无未成年疑似、无非同意、无 IP/名人脸)+ 07 §3.2 的"已充分转化"判定(若用了竞品帧作风格参照)。
3. **入 adex**:产物落 `Creative(source:'remix', sourceRef=竞品externalId, reviewStatus:'pending')`(07 §3.2);**人工 approve(`/creatives/review`)是 IP/授权终审门,不自动化**。
4. **变体与本地化**:审核通过后走 Creative Studio 变体矩阵做 平台×格式×钩子×语言 扇出;多语言按 Hakko 本地化 SOP 分层 L0(换尾帧)/L1(重配 VO)/L2(遮写烧录字)。

## 7. 落地节奏 — 对齐 07 §7 分期

数据模型、API、取数连接器以 07 §4/§5 为准;本文档补充的是各期的**工艺交付物**:

| 期(同 07) | 本文档的工艺交付 |
| --- | --- |
| **Phase 0 手工 PoC** | 10~20 条爆款走一遍 ③④⑤:人工分级 → AppGrowing AI Prompt 改写为 Cuddler 差异化 prompt → Seedance2 出 3~5 条 → 红线 checklist 人工过。验证 L3 工艺可行性 + 单条成本 |
| **Phase 1 情报库** | **独立目录**(已确认,`/Users/mt/work/project/github/creative-pipeline`)固化脚本:本地四件套批处理、优先级排序、分级建议器(v1 规则版,LLM 精排后续加)、QC 预检;对 Hakko/Luddi 已盘点素材回归验收 |
| **Phase 2 Remix 引擎** | ④ 的路由管线接进 `RemixJob`:Seedance2 逐镜生成、video-use 口播线、录屏线、统一收尾脚本、尾帧/logo 插槽批量补渲染 |
| **Phase 3 自动化** | 分级建议器接每日同步;QC 预检做成 review 页的辅助信号(残留检测结果随 Creative 展示给审核人) |

工艺脚本稳定后并入 adex(转码 worker / render worker,填 [04-status.md](04-status.md) 的 render seam),入库前过 schema/契约评审。

## 8. 分工

**建设期(写脚本/接系统)**:

- 主会话(Fable 5):流程与判据设计、分级 prompt、红线清单、Remix 抽取器系统提示("借结构不复刻"写死)、验收。
- fast-worker:固化脚本(四件套批处理、ffmpeg 模板参数化、QC 预检、统一收尾)——验收标准:对 Hakko/Luddi 已盘点竞品素材复现出与现有 csv 一致的产物。
- deep-reasoner:Phase 2 接 adex 前的 schema/契约评审(不可逆决策)。

**运行期(日常生产)**:

- 全自动:①采集编目、②双分析层、⑤脚本预检。
- LLM 建议 + 人批量确认:③分级路由(人只看分级建议表,改错的);AI Points 花费需人确认(点数月度过期,见 07 §1.4)。
- 人工必审:⑤ IP/授权终审门、投放前 approve;付费放量决策永远是人的(与 playbook §6 一致)。

## 9. 决议记录与遗留项

**已确认(2026-07-09)**:① 新产品 = Cuddler;② 取数走 07 §5-B 桥接(过渡);③ Phase 1 工艺脚本独立目录起步、稳定后并入 adex;④ 销售侧(Skill/API)与法务口径均无阻塞。

**遗留决策**(在 07 §8 跟踪):首个种子赛道/竞品/区域、AI Points 预算(优先花将过期的 2,000 点)。

注:法务通过的是"借结构不复刻 + 人工审核门"这套口径;§4.1 中"L1/L2 对 Cuddler 默认不投放"的限制**依旧保留**——它来自 pilot 门禁对 IP-洁净素材的要求,不随法务口径解除。若要为 Cuddler 放开 L1/L2 探针投放,需单独决策。
