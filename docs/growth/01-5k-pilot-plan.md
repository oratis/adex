# Cuddler $5K 首投 Pilot 设计（正反方辩论 + 裁决落地）

> 版本：v1 · 2026-07-04 · 上位文档：[00-cuddler-first-redesign.md](00-cuddler-first-redesign.md)
> 方法：对 6 个关键决策组织正反方辩论 → 逐题裁决 → 落地为可执行参数。裁决把**败方的合理担忧转化为对胜方方案的约束**，不是各打五十大板。
> 前提（不可推翻）：Cuddler 初期即付费投放，首期总预算 **$5,000**。辩题是"怎么花、Adex 怎么支撑"。

---

## 0. 一句话结论

**$5K 是买决策数据的信息预算，不是增长预算。** 它在约 20 天内花完，换回一个可信答案：**哪个付费渠道的前段漏斗质量最接近有机 beachhead、最值得用更大预算去正式测**——而不是"哪个渠道已盈利"（$5K 样本在数学上无法回答后者）。一切设计服从两个目标：**最快拿到可复核的数字**、**最小化不可逆损失**。

### 裁决总表

| # | 争点 | 裁决 | 一句话理由 |
|---|---|---|---|
| P1 | 何时启动 | **门禁制，非日历制**（约上线+3–4 周主投；$500 探针可先行） | 前置条件多为配置级可快闭合，但"归因未就绪就开投"= 只买到一个测不出的混合平均数 |
| P2 | 渠道分配 | **按归因洁净度分臂，不按平台**：web 漏斗为主测量臂 40%、ASA 25%、iOS-SKAN 15%、机动 20% | Cuddler 不上 ATT（已核实）→ iOS 社媒只剩 SKAN；web 漏斗走 GA4/Stripe 确定性归因且毛利更高，是比 ASA 更干净的测量脊柱 |
| P3 | Adex 介入深度 | **按渠道拆**：Meta/TikTok 在 Adex 内建（dogfooding+audit+防漂移）；ASA 手工+度量回灌 | 正方"只做度量塔"与其 P6"系统强制暂停"自相矛盾——不能可靠暂停你没创建的东西 |
| P4 | 首批素材 | **官方自制优先**（IP 洁净+AIGC 标注+完整广告结构）；用户 scene 作素材后置 | scene 即广告是对的长期战略，但水印管线未完成、导入角色 IP 风险在"商业分发"下升级 |
| P5 | kill/scale 判据 | **序贯里程碑门 + eCAC***：proxy 只能触发 kill，scale 必须见真实付费信号 | 30 天 LTV:CAC 在 pilot 内数学上不可用；proxy 单用会给"高活跃高亏损"渠道错误加码 |
| P6 | 预算风控 | **三层防线**：平台原生 cap 为主 + Adex pacing 告警 + 单向"降"自动兜底 | 日同步报表延迟下无差别自动暂停会误伤 learning phase；但机器速度超支必须有机器速度刹车兜底 |

### 两条贯穿全局的综合判断（辩论催生，非任一方独有）

**综合 A — web 漏斗是 pilot 的测量脊柱。** 正方要 ASA 是为了归因洁净，反方翻出 web 漏斗——二者其实指向同一目标的更优解：Cuddler 明确不上 ATT（`prd_mobile_app.md:317`"App Tracking Transparency：不使用跨应用追踪"），所以 iOS 上 Meta/TikTok 的 app-install 只能靠 SKAN，$5K 量级下 postback 大量因隐私阈值置空；而把部分社媒预算导向 cuddler.ai 网页注册/订阅，可用 GA4 + Stripe/PayPal 拿到**确定性、近实时、关键词/campaign 级**的归因，且 web 毛利更高（`unit_economics.md:129` Pro web 净额 ~$9.10 vs mobile 抽成后 $8.49/$6.99）、视频亏损敞口更小（web 订阅者只有日额度、不发月度 credit lump，`unit_economics.md:116`）。**结论：不需要靠 ASA 逃离 SKAN——web 漏斗是更干净、更高毛利的同一条逃生路。** 它同时穿起 P1（web 臂不依赖 APPLE_TEAM_ID/SKAN，前置更少可更早跑）、P2（主测量臂）、P5（真实付费信号最干净地来自 web Stripe）、P6（web 转化 Adex 近实时可见，不像 SKAN 24–48h 空回传）。

**综合 B — "手工建 + 自动暂停"是不自洽的。** 正方 P3 要手工建 campaign、P6 又要系统强制暂停——但人在平台后台改、Adex 在 API 改，双写方必然状态漂移，每小时 agent 基于陈旧状态决策反而更危险。反方抓住了这个矛盾。裁决因此把 **API 可达的渠道（Meta/TikTok）交给 Adex 创建**（guardrail 才有合法写入方），**ASA 无 adapter 则手工 + 每日对账 + 文档明示为手工风控盲区**。

---

## 1. 逐题辩论与裁决

> 每题：**争点 → 正方最强点 → 反方最强点 → 裁决与理由 → 落地参数**。

### P1 · 启动时机

**争点**：$5K 应在 iOS 上线 2 周内启动，还是等更多前置条件？

- **正方（快启动）**：$5K 视频亏损敞口有硬上界（按 CPI $3–5 买 1,000–1,600 装机、20–40% 尝鲜视频，增量 COGS ≈ $300–900，占预算 6–18%，是封顶学费不是螺旋）；前置条件多为配置级（RC webhook 只差填 secret、GA4 已埋、TEAM_ID 本是提审必填）；CAI 难民迁移潮是流失中的现货窗口。
- **反方（门禁启动）**：Cuddler 自己的 GTM 把付费列第 7 位标"暂缓——等重定价+漏斗跑通"（`gtm_strategy.md §7/§12`）；归因未就绪时开投只得到"混合平均数"，而其 benchmark 文档明示"必须按渠道拆 D1"；越早买进订阅者，锁进旧价的亏损 cohort 越大（重定价要 grandfather 存量）。

**裁决：门禁制，非日历制。** 反方对"日历驱动"的否定成立——没有归因就开投等于烧样本；但正方对"前置多为配置级、窗口在流失"的判断也成立，反方"等自然基线 n≥500"作硬门禁则过严（上线初期有机量级每周几十装机，作对照噪声大于信号，正方此点更对）。综合：**用一份可快速闭合的最小测量门禁清单替代日期**，主投在门禁全绿后开（现实约上线+3–4 周），同时采纳反方的 $500 探针作为账号预热机制——探针只读 CTR/CPM/过审，不依赖归因，可在门禁未全绿时先跑。

**落地**：
- **Phase 0 探针**（账号开设即可跑）：$500（Meta $250 + TikTok $250），仅测素材 CTR/CPM、预热账号信任分、试探审核政策，**不做任何 kill/scale 结论**。
- **主投解锁**：门禁清单（见 §2）全绿后开 $4,500；起量 $150/日 × 首周 → $250/日封顶（20–30 天烧完）。
- **硬前置（采纳反方底线）**：Cuddler 侧**视频分层日上限**必须先上线（配置级，封住 loss-leader 敞口）；CAC 口径必须计入媒体补贴 COGS（→ eCAC*，见 P5）。

### P2 · 渠道分配

**争点**：预算向 ASA 集中（≥50%），还是均摊/其他？

- **正方（ASA 集中）**：ASA 走 Apple AdServices token，无需 ATT、确定性归因到关键词级——是 $5K 量级下唯一 P5 判据完整可观测的渠道；搜索流量自带意图，契合"正在搜替代品的 CAI 难民"；$2,750 ≈ 550–900 高置信装机，单渠道即达统计功效。
- **反方（反 ASA 集中）**：新品牌品牌词搜索量≈0、竞品词红海抬价，$2,500 大概率花不出去；受众（18–28、女性倾向、CAI 难民）聚在 TikTok，scene 是 TikTok/Reels 原生素材而 ASA 只展示商店素材；**web 漏斗可绕 SKAN**——Meta/TikTok 投 cuddler.ai 网页订阅可用 pixel+GA4 全链路归因且毛利更高。

**裁决：两个结论都否，改按归因洁净度分臂。** 核实两条决定性事实后（不上 ATT ✓、web 毛利更高且损耗更低 ✓），正方"把钱投给能测的渠道"这个**原则**对，但"ASA 是唯一/最佳测量渠道"这个**结论**被反方的 web 漏斗证否——web 漏斗是更干净、更高毛利、且契合 TikTok 受众的同一目标解。反方对 ASA 搜索量天花板的判断也成立，故 ASA 保留但不 ≥50%。iOS-app-install（SKAN）因测不准，降为"reach 测试臂"，不作判据来源。

**落地（分配表）**：

| 臂 | 渠道 | 预算 | 占比 | 角色 | 归因 |
|---|---|---|---|---|---|
| **web 漏斗**（主测量臂） | Meta→web $1,250 + TikTok→web $750 | $2,000 | 40% | 判据主来源；测高毛利变现路径 | GA4 + Stripe/PayPal，**确定性、近实时** |
| **ASA**（iOS 意图捕获） | Apple Search Ads（exact match 品类词/竞品词） | $1,250 | 25% | iOS App Store 意图流量；自归因兜底 | AdServices token，确定性 |
| **iOS-SKAN**（reach 测试） | Meta iOS $500 + TikTok iOS $250 | $750 | 15% | 只测触达/CTR，**不作 kill/scale 判据** | SKAN，$5K 下多为空回传 |
| **机动** | 过 Gate B 后加给赢家 | $1,000 | 20% | scale-reserve | 跟随赢家臂 |

- Google UAC 本轮 $0（其出价器需转化量喂养，小预算下最弱，正反双方一致）。
- 品牌词单独小额（$150，含在 ASA 内）圈护，避免自归因"抢功"污染测量。
- ASA 无 adapter → 手工投 + 度量回灌（见 P3）。

### P3 · Adex 介入深度

**争点**：pilot 期 Adex 只做度量塔+预算守护（campaign 手工建），还是尽早在 Adex 内建创建链路？

- **正方（只做度量+守护）**：为 6–8 周、约 10 个 campaign 的 pilot 建创建自动化，摊销不成立；创建/改价 API 写错一个字段就烧真金，pause/cap 是 fail-safe，首次实弹应握刹车不握油门；稀缺工程该花在"缺了就无法决策"的统一 CAC 看板上。
- **反方（尽早建创建链路）**：三平台 adapter 已存在，缺的只是 app_promotion objective 分支（估 3–5 天/平台），不是"建平台"；第一个客户的第一笔投放是唯一的 dogfooding 机会，全手工=零案例零 audit；手工改+API 改必然状态漂移（呼应综合 B）；复投时结构锁死后台，要从零重建。

**裁决：按渠道拆，用综合 B 化解矛盾。** 反方的 dogfooding/audit/防漂移三点成立，且正方 P3（手工）与 P6（自动暂停）不能同真——系统强制暂停要求 Adex 是写入方。故 **Meta/TikTok（API 可达）在 Adex 内建**（工程量是 objective 分支非新平台，反方对成本的估计更准）；**ASA（无 adapter）手工建**但注册 ID + 每日 CSV 回灌 + 手工操作补记 AuditEvent（正方对"不为小 pilot 建 ASA adapter"的判断在此渠道成立）。正方"握刹车"的哲学以**pilot 自动化只开降/停、禁止自动扩量**的形式保留。

**落地**：
- Meta/TikTok：P19 交付最小创建链路（app-install + web-conversion 两 objective）；pilot 期 agent 自动化仅"降预算/暂停进审批队列"，扩量一律人工审批。
- ASA：手工建 → campaign ID 注册进 Adex → 每日报表 CSV 回灌统一看板 → 手工操作补记 audit。**文档明示 ASA 为手工风控盲区**（采纳反方 P6 底线）。
- 复投：pilot 的 campaign 结构 + A/B 结论沉淀为 Adex 模板，P20 ASA adapter 落地后收编。

### P4 · 首批素材

**争点**：首批素材用人工挑选的 Cuddler 用户 scene 直投，还是官方自制？

- **正方（用户 scene 直投）**：产品即广告是 Cuddler 既定战略（`gtm_strategy.md §6`）；scene 天生竖屏短视频、与 Reels/TikTok 零转换；素材=真实产品体验，避免"广告很美产品落差"打穿 D1；Seedance2 生成能力已在。
- **反方（官方自制优先）**：产品内置 Character Card 导入 → 大量用户角色是动漫/竞品 IP，UGC 在 feed 流通 vs 用于商业广告是两个法律世界；新账号信任分为零 + RP 素材 + AIGC，首周易吃 policy strike 冻结整个 pilot；水印管线是 Cuddler 侧 P0 未完成；scene 原片 5s 无 hook/end-card/CTA。

**裁决：官方自制打首批，用户 scene 作素材后置。** 正方的"scene 即广告"是正确的**长期飞轮**（也是 Cuddler 自己的战略），但反方指出的三个**当下阻塞**都成立：水印管线未完成、导入角色 IP 在商业分发下责任升级、裸 5s 片无广告结构。为省 3–5 天素材工期而赌 $5K 流量+账号存活，不划算。故首批用官方自制（Adex 现有 Seedream/Seedance2 + Cuddler 原创角色），用户 scene 作素材走 [00 文档 §6](00-cuddler-first-redesign.md) 的 review 门（ToS 授权 C7 + 创作者 opt-in + 逐条 IP 审 + 水印）后，P20 起接入。

**落地**：
- 首批 10–14 条官方自制：结构 = 3s hook + 5s scene + 2–4s end-card（App Store/web CTA），1080×1920，AIGC 标注开启，法务 checklist（无导入角色、无真人相似、PG-13 剪辑）。
- 5 概念 × 2–3 剪辑：互动短剧分支瞬间 / chat→film 变身 / 语音对比竞品 / CAI 难民文案 / 女性向情感线（正方的概念清单可用，只是换成官方角色演绎）。
- 每条广告吃 $50–100 消耗才有读数 → 10–14 条恰配 web+iOS 社媒臂的 $2,750，不碎片化 learning phase。

### P5 · kill/scale 判据

**争点**：用 proxy 指标（CPI/激活/D1/trial），还是 30 天 LTV:CAC？

- **正方（proxy）**：$5K@$250/日 = 20 天花完，30 天 cohort 满时 pilot 已结束 3–4 周，用一个 pilot 生命周期内不存在的指标做判据等于没判据；30 天订阅收入/装机 ≈ $0.17，对任何 CPI $3–5 渠道 LTV:CAC ≈ 0.03–0.06，**把所有渠道都判死的判据区分度为零**；proxy 在装机次日即累积，统计功效够。
- **反方（proxy 有陷阱，需精炼）**：媒体越活跃越亏（每条视频 −$0.5–1），高 D1 低付费渠道会诱导给"亏损放大器"加预算；$5K÷3 渠道每渠道 300–550 装机，转化真值 2% 时 n=400 的 95% CI≈0.6–3.4%，1% 与 3% 渠道不可分；trial≠付费（AI 陪伴类 trial→paid 估 30–60%）；SKAN 下 Meta/TikTok 的 trial 率可能根本测不到。**反方明确承认 30 天 LTV:CAC 同样不可用**——答案是换框架不是退回裸 proxy。

**裁决：反方框架胜（序贯里程碑门 + eCAC*），正方的 PRD 锚定 proxy 作为快速 kill 层保留。** 双方在"30 天 LTV:CAC 不可用"上其实一致（正方证明它零区分度，反方承认它样本不足）。真正的分歧是"裸 proxy vs 精炼 proxy"，反方的三个精炼都对且重要：① **eCAC*** = (spend + 媒体补贴 COGS) / 装机，修正视频 loss-leader 让裸 CPI 系统性低估真实 CAC；② **D7 > D1**（novelty 视频产品 D1 可能只是猎奇）；③ **proxy 只能 kill，scale 必须见真实付费信号**——这是防"高活跃高亏损"陷阱的关键纪律。正方对"判据必须在 pilot 生命周期内存在"的坚持，以 proxy 作 Gate A 快速 kill 层落地。

**诚实边界**：$5K pilot 能回答的是"哪个渠道最不坏、最值得更大预算去正式测"，**不能**回答"哪个渠道已盈利"（scale 门的付费样本仅个位数，CI 宽，只作方向性放行不作盈利证明）。

**落地（序贯门，按单渠道累计花费触发）**：

| 门 | 触发（单渠道花费） | 判据 | 动作 |
|---|---|---|---|
| **Gate A**（机械地板，proxy） | $400 | 装机 <50 **或** CPI >$8 **或** 首聊完成 <40% | → **KILL** |
| **Gate B**（质量确认） | $800 | 用 eCAC* 替代 CPI、D7 替代 D1；真实 RC 付费用户 ≥3 | 未达 → 预算减半；达 → 继续 |
| **Gate C**（放量放行，方向性） | $1,250 | 付费用户 ≥5 **且** 每付费用户成本 ≤ 5× 首月净收入（≈$42.5）**且** 以有机基线为先验 P(转化<1%) <75% | 达 → 释放机动预算加码；否则 → 收 |
| **全局 kill** | 累计 $2,500 | 混合 eCAC* > $8 | → 全面冻结加码，只保留度量 |

- 阈值锚定 Cuddler PRD §1 既定目标（首聊 ≥55%、D1 ≥30%、D7 ≥18%、订阅 ≥2%），非拍脑袋。
- **纪律**：proxy 指标只允许"降/停"；任何"加预算"必须有 RC 真实付费信号支撑（`payment_signal_gate` guardrail）。

### P6 · 预算风控执行

**争点**：$5K 硬顶 + 日 cap 由 Adex 系统强制自动暂停，还是别的机制？

- **正方（Adex 强制自动暂停）**：Google 单日可花到日预算 2×、Meta 允许单日超支按周再平衡，机器速度超支 + 人工小时级发现延迟，单次事故可吞预算 5–10%；Adex 每小时循环把暴露窗压到 ≤1h；投放 7×24 而单工程师盯守 ≤50h/周；边际成本近零（复用现有 guardrail+审批+执行器）；预算护栏就是 Adex 的核心产品承诺。
- **反方（三层防线，慎用自动暂停）**：Adex 报表日同步，"自动暂停"实际基于 T-1 陈旧数据，既滞后又高频误触；**learning-phase 重置代价 > 超投代价**（Meta ~50 转化/adset/周，暂停 ≥7 天必重置，CPI 抬升 20–50% 持续数日；而 Google 日 cap 最坏超投仅 1 日额度）；ASA 无 adapter 时"系统强制硬顶"是假安全感；平台原生 cap 在竞价层零延迟生效，下游用滞后数据重造闸门是负价值。

**裁决：反方三层设计胜，保留正方的机器速度兜底作为最外层。** 反方对"日同步数据驱动无差别自动暂停会误伤 learning phase"的机制分析成立，且 ASA 假安全感一针见血；但正方"机器速度超支必须有机器速度刹车"的不对称性也真实——纯靠人盯 168h 钱包是制度性事故。综合：**主保险上移到平台原生 cap（零延迟、竞价层），Adex 做 pacing 预测告警 + set-and-verify 漂移核验，自动动作只保留单向"降"且仅在恶性突破时触发**（正方的兜底以最外层形式保留，但不再是第一道闸）。

**落地（三层防线）**：
1. **主保险 — 平台原生 cap**：每个广告账号设 account-level spending limit = $5K；每条 campaign 日预算/终身预算由 Adex 写入并**每日核验漂移**（set-and-verify）。
2. **Adex — pacing 告警**：按 $250/日总盘预测，80%/100% pace 触发 → 审批队列人工暂停，SLA 4h（4h 敞口 ≈ $40）；spend 台账与平台上报偏差 >10% 告警。
3. **兜底 — 单向自动降**：单渠道 spend >150% 日 cap **或** CPI >3× 目标（n≥30）→ 自动暂停，恢复必须人工审批；**learning-phase 前 7 天仅告警不自动暂停**（除非 >200%）；全局台账 $4,750（95%）→ 自动暂停所有 API 可达渠道 + kill-switch 通知。
4. **ASA 盲区**（采纳反方底线，写进文档）：无 adapter → console 设 lifetime budget + 每日人工对账 runbook；Adex 侧仅告警，不谎称能强制该渠道。

---

## 2. Pilot 启动门禁清单

主投（$4,500）解锁的前置。前 6 项是硬阻塞（缺一不可），探针 $500 不受此约束可先跑。

| # | 门禁项 | 归属 | 为何是硬阻塞 |
|---|---|---|---|
| G1 | RevenueCat webhook → Adex ingest 打通，订阅事件 <5min 入库 | Cuddler（填 secret）+ Adex | 无真实付费信号 → P5 的 scale 门失效，只能盲 kill |
| G2 | GA4 web 转化事件（signup/subscribe）× UTM 校验通过 | Cuddler（埋点已在）+ Adex | web 漏斗是主测量臂，无此则 40% 预算测不出 |
| G3 | ASA AdServices token 采集端点 + web pixel 上线 | Cuddler + Adex | ASA/web 归因入口 |
| G4 | Cuddler 视频分层日上限已上线 | Cuddler | 封住 loss-leader 敞口（采纳反方 P1 底线） |
| G5 | 各广告账号 account-level spending limit = $5K 已设 | 运营 | 主保险（P6 三层第 1 层） |
| G6 | Adex 预算守护引擎 e2e 通过（$5K 触顶自动暂停 API 可达渠道） | Adex | 兜底闸（P6 三层第 3 层） |
| G7 | 10–14 条官方自制 IP-洁净素材就绪 | Cuddler + Adex 创意 | P4 裁决 |

> 门禁是**清单**不是**日期**（P1 裁决）。全绿即可启动，与 Cuddler 上线日解耦——上线晚，pilot 顺延，不因赶日历跳过门禁。

---

## 3. Pilot 时间线

```
账号开设 ──► Phase 0 探针 $500（Meta/TikTok 各 $250，测 CTR/过审/预热，无判据）
                │  （门禁 G1–G7 并行闭合）
门禁全绿 ──────► 主投启动 $4,500 @ $150/日→$250/日
                │
  单渠道 $400 ─► Gate A：机械 kill（坏 CPI / 无装机 / 低首聊）
  单渠道 $800 ─► Gate B：eCAC*+D7+真实付费≥3 → 减半 or 继续
  累计 $2,500 ─► 全局 kill 检查（混合 eCAC*>$8 → 冻结加码）
  单渠道 $1,250► Gate C：付费≥5 → 释放 $1,000 机动给赢家（方向性放行）
                │
  ~$5K 花完 ──► pilot 复盘 → 输入 P21 guardrail 阈值校准 + 放量 or 换客户决策
```

预计主投 20–30 天。全程在 [`/growth/channels`](00-cuddler-first-redesign.md) 看板显示分渠道 eCAC*/D7/付费数/gate 状态灯 + $5K 台账进度。

---

## 4. Adex 工程范围（pilot 必需 vs 可后置）

| 能力 | pilot 必需？ | 落在 | 说明 |
|---|---|---|---|
| GA4 / RC / ASC connector + ConversionEvent/CohortSnapshot | ✅ 必需 | P18 | 度量脊柱 |
| **web 转化归因**（UTM→channel，近实时） | ✅ 必需 | P18 | 主测量臂，综合 A |
| Meta/TikTok app-install + web-conversion **创建链路** | ✅ 必需 | P19 | P3 裁决，dogfooding |
| 预算守护引擎（三层） | ✅ 必需 | P19 | P6 裁决 |
| ASA 度量回灌（CSV 导入 + 手工 audit） | ✅ 必需 | P19 | P3 裁决，ASA 无 adapter |
| kill/scale 序贯门 evaluator（cron） | ✅ 必需 | P19 | P5 裁决 |
| 官方素材 = 现有创意库手工上传 | ✅ 够用 | 现有 | 不需新管线 |
| **ASA adapter**（自动化） | ❌ 后置 | P20 | pilot 手工投即可 |
| **完整 app-install 自动化** + Google App Campaign | ❌ 后置 | P20 | pilot 用最小分支 |
| **scene 素材管线**（ingest+打标+规格化） | ❌ 后置 | P20 | pilot 用官方自制，P4 裁决 |

**要点**：pilot 不需要"完整付费能力"，只需要 P18+P19 的**最小可测闭环**。ASA 自动化、scene 管线这些重项后置到 P20，不阻塞 8 月的 $5K。

---

## 5. 对 [00 文档 §9 对接契约] 的 pilot 新增前置

| # | Cuddler 侧需提供 | 对应门禁 | 时点 |
|---|---|---|---|
| C-P1 | 视频分层日上限上线（封 loss-leader） | G4 | 主投前（硬阻塞） |
| C-P2 | RC webhook secret 填入 + 转发 Adex | G1 | 主投前（硬阻塞） |
| C-P3 | GA4 web 转化埋点校验 + ASA AdServices token 端点 | G2/G3 | 主投前（硬阻塞） |
| C-P4 | 各账号 account spending limit=$5K + ASA console lifetime budget | G5 | 主投前 |
| C-P5 | 官方原创角色素材源（供 Adex 创意生成 IP-洁净首批） | G7 | 主投前 |
| C-P6 | UTM 命名规范 `utm_source=adex_{arm}`、`utm_campaign={adex_campaign_id}` 透传到 web | G2 | 主投前 |

---

## 6. 未决问题（需 Cuddler 确认）

1. **视频重定价与 pilot 的先后**：反方主张重定价灰度完成才主投，正方主张仅需"free 档视频日上限"配置级先行。裁决取后者（G4）——但若 Cuddler 判断存量订阅者 grandfather 损失敏感，可要求重定价先行，pilot 顺延。**决策权在 Cuddler。**
2. **web vs app 落地目标**：web 漏斗臂把用户导向 cuddler.ai 注册订阅——需 Cuddler 确认 web 端 onboarding/paywall 转化体验足以承接付费流量（若 web 转化显著劣于 app，主测量臂需回调向 ASA 加权）。
3. **$42.5/付费用户的 scale 门系数**（5× 首月净收入）：基于订阅 ~5 个月回收假设，需 Cuddler 财务确认可接受的回收周期。
