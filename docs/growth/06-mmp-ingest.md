# MMP（Adjust / AppsFlyer）接入新数据链路指南

> 版本 v1 · 2026-07-07 · 结论先行：**MMP 走 S2S callback → ConversionEvent；接之前必须先堵三个洞，否则 GA4 + MMP 双开会让 install 翻倍、CAC 腰斩，且现有测试测不出来。**

## 0. 现状：MMP 只喂旧链路

`src/lib/platforms/adjust.ts` / `appsflyer.ts` 目前只做一件事：`reports/sync` 拉 app 级日聚合（Adjust 维度仅 `day,app`，无渠道拆分）→ 写 `Report(level=account)` → `/dashboard` 展示。**这条旧链路保留不动**——它是"MMP 原生总量视图"，与新链路（ConversionEvent → CohortSnapshot → `/growth` + agent perceive）物理隔离（读写零交集），二者数字对不上是口径差异，不是 bug，不要试图对齐。

真正的冲突全在新链路内部：让 MMP 往 ConversionEvent 写数据时，它会和 GA4 在同一张 CohortSnapshot 里打架。

## 1. 三个必堵的洞（接入前置，缺一不可）

| # | 洞 | 成因 | 后果 | 堵法 |
| --- | --- | --- | --- | --- |
| 1 | **双源 install 重复计数** | 幂等键 `@@unique([orgId, source, eventName, userKey, occurredAt])` 把 `source` 算进唯一约束（GA4/Adjust 各落一行），而 `cohorts.ts` 聚合完全不感知 source、只按 userKey 分组累加 | installs 翻倍 → CAC 腰斩 → gate 判定（放量/CAC 上限）资损级误判 | `RawEvent` 加 `source` 字段；cohort 聚合前按 org 配置的 install 权威源单选（见 §2 决策 A） |
| 2 | **channel 归一化失配** | `channels.ts:resolveChannel` 只认 `adex_*` UTM 和 kol/seo 等裸码；MMP 的 network 名（"Apple Search Ads"、"Meta Installs"）全部兜底成 `organic` | 同一渠道在 CohortSnapshot 裂成两行（如 ASA 裂成 `organic` + `paid_asa`），看板和 gate 各算各的 | 新增 `ADJUST_NETWORK_MAP` 显式映射表 + `resolveAdjustChannel()`；**不要扩 `resolveChannel`**（它服务自有 UTM 主路径） |
| 3 | **userKey 跨源断裂** | 留存 D1/D7 = "同一 userKey 在 +1/+7 有 GA4 行为事件"；RC 收入也靠 userKey join。MMP 的 adid/idfa 与 GA4 pseudo_id、RC app_user_id 是不同命名空间 | MMP 渠道的 cohort **留存和 LTV 假性归零**；同人被当两个 user 重复计 install | 首选：callback 透传 RC `app_user_id` 统一 userKey（需客户侧配置，Adjust callback parameter 支持，SDK v5 addGlobalCallbackParameter，v4 addSessionCallbackParameter）；降级：userKey 加 `adjust:` 前缀、承认跨源不 join（见 §2 决策 B） |

## 2. 两个口径决策（已拍板）

- **决策 A · install 权威源**（已拍板）：接了 Adjust 的 org，install 与渠道归因以 `source='adjust'` 为权威；GA4 只供 first_chat / scene_generated 等 Adjust 不报的漏斗深层事件。实现：`kpi-canon.ts:resolveInstallAuthority({ hasAdjustAuth, adjustInstallCount, ga4InstallCount })`——org 存在 `PlatformAuth(platform='adjust')` → `'adjust'`，否则 `'ga4'`。**防归零保险**：若权威源在计算窗口内 install 数为 0 而另一源 > 0（例如 org 只配了 legacy Report 凭证、没接 `/api/ingest/adjust` callback），本次计算回退另一源，并在返回值 `fallback`/`warning` 字段标注，`growth-sync` cron 会把 warning 打进日志。`cohorts.ts:buildCohortSnapshots` 的 `opts.installAuthority` 据此只过滤 ACQUISITION 类事件（install/signup）的来源；漏斗深层/收入事件不受影响。
- **决策 B · userKey 统一方式**（已拍板）：userKey 首选 Adjust callback 透传的 RC `app_user_id`（**callback parameter**——注意不是 partner parameter：partner params 转发给广告网络，callback params 才回到自有 raw-data callback；键名约定 app_user_id，客户端注册成功后经 SDK 设置。对标 AppsFlyer 的 CUID/customer_user_id）；取不到时降级为 `adjust:${adid}` 前缀，明确承认这条 userKey 跨源不可 join——留存/LTV 仍以 GA4/RC 体系计算，Adjust 只贡献 install 计数与渠道校正。实现见 `adjust-ingest.ts:mapAdjustCallback`。

## 3. 接入步骤（Adjust，S2S callback 方案）

**不推荐**用 Report Service API 拉聚合造合成事件——聚合行没有 userKey，进不了 cohort。

1. **堵洞（代码前置）**——已完成
   - `src/lib/growth/cohorts.ts`：`RawEvent` 加 `source`；`buildCohortSnapshots(events, { installAuthority })` 聚合前按决策 A 单源过滤 ACQUISITION 类事件（install/signup），漏斗深层/收入事件不过滤；`growth-sync` cron 查询同步加 `source` select
   - `src/lib/growth/channels.ts`：新增 `ADJUST_NETWORK_MAP: Record<string, Channel>` + `resolveAdjustChannel(networkName, campaignName)`。ASA 确定性映射；Meta/TikTok 的 install network 名（`Facebook Installs` / `TikTok Installs` 等）保守映射到 `*_ios`（SKAN，低置信度）——Adjust 的 network_name 分不清 web 与 app-install，`campaign_name` 含 "web" 时才改判 `*_web`；未映射网络名 → `organic`/`inferred`。未改动 `resolveChannel` 一行
   - `src/lib/growth/adjust-ingest.ts`（新建 + 测试）：`mapAdjustCallback(params, eventTokenMap?) → ConversionEventInput | null`，照 `ga4.ts:mapGa4Event` 的写法；`activity_kind='install'` → `install`；`='event'` 时查 `eventTokenMap`（event token → canonical `EventName`，映射不到 → drop）；`reattribution`/`session` 等 → drop（返回 null，不抛错）
   - 测试含**双源用例**（`cohorts.test.ts`）：同一真实安装的 GA4 + Adjust 两行（不同 userKey namespace）不设权威时 installs=2（复现洞 1）；设 `installAuthority: 'adjust'` 后 installs=1 且渠道以 Adjust 行为准；另有用例确认 installAuthority 不过滤漏斗深层事件
2. **鉴权路由**——已完成，选定方案一
   - `GET|POST /api/ingest/adjust?org=<id>`（`src/app/api/ingest/adjust/route.ts`），静态密钥 + `verifyBearer`（仿 `src/app/api/ingest/revenuecat/route.ts`）。**密钥槽独立**：存 `PlatformAuth(orgId, platform='ingest_adjust').apiKey`，env `INGEST_ADJUST_SECRET` 兜底——不与 `/api/ingest/events` 的 HMAC 密钥共用，因为 Adjust token 走 `?token=` 明文 query 会进访问日志，泄漏不能连带 HMAC 伪造。同一行的 `extra` JSON 配置 **event token 映射**：`{"eventTokenMap":{"<adjust event token>":"trial_start"}}`——不配置时非 install 事件会被安全丢弃（200 ignored），install 不受影响；Adjust 侧密钥支持 `Authorization: Bearer` 或 `?token=` query（callback 是 URL 模板，设不了自定义 header）；单条映射失败跳过（200 ok, ignored），不 5xx；写入沿用 `createMany` + `skipDuplicates` 幂等
3. **Adjust 后台配置**：Raw Data Exports → Real-time callbacks，install + 关键 event 各配一条，URL 带 placeholder：`{activity_kind}`、`{network_name}`、`{campaign_name}`、`{adid}`、`{idfa}`、`{created_at}`、`{country}`，及透传的 callback parameter（决策 B 的 app_user_id；placeholder 具体写法配置时以 Adjust 后台文档核对）
4. **验证清单**：同一 callback 重放两次只落一行（幂等键）；ASA/Meta 的 network 名映射进正确 channel（不落 organic）；GA4+Adjust 双开的 org 在 `/growth` 的 installs 与单开 MMP 一致；`/dashboard` 的 Report.adjust 总量不受影响

## 4. AppsFlyer 附注

同构接入：Push API（S2S 实时回传）对应 Adjust callback，`pid/c` 字段对应 `network_name/campaign_name`（需 `APPSFLYER_NETWORK_MAP`），设备标识 `appsflyer_id` 同样是独立命名空间——三个洞和两个决策**一字不差地适用**。旧链路 `getInstallReport`（`groupings=date,pid`）同样保留不动。AppsFlyer 接入尚未实现，本节仍是规划。

## 5. 涉及文件速查

| 动作 | 文件 | 状态 |
| --- | --- | --- |
| 新建 mapper | `src/lib/growth/adjust-ingest.ts`（+ `adjust-ingest.test.ts`） | 已完成 |
| 新建路由 | `src/app/api/ingest/adjust/route.ts`（GET+POST） | 已完成 |
| 改：channel 映射 | `src/lib/growth/channels.ts`（`ADJUST_NETWORK_MAP` / `resolveAdjustChannel`，+ 测试） | 已完成 |
| 改：单源聚合 | `src/lib/growth/cohorts.ts`、`src/app/api/cron/growth-sync/route.ts`（+ 测试） | 已完成 |
| 改：口径记录 | `src/lib/growth/kpi-canon.ts`（`resolveInstallAuthority`，+ 测试）、本文件 §2 | 已完成 |
| 不动 | `src/lib/platforms/adjust.ts` / `appsflyer.ts`、`reports/sync`、`/api/ingest/events` 鉴权、`ingest-parse.ts`（`source='adjust'` 已注册） | 按计划不动 |
| 未实现 | AppsFlyer S2S 接入（§4 仍是规划，非本次范围） | 待办 |

## 6. 注册锚点与 BI 口径（已拍板）

新增 `os`（ios/android/web）与分端 BI 视图，逼着我们把"获客锚点到底是谁"钉死——之前 cohort 锚点隐含"install 优先"，signup 只是 install 缺失时的兜底；现在反过来：**signup 优先**，因为它是我们自己的一方事件，不参与 GA4/MMP 双源撞车问题。

- **获客锚点**：用户的 cohort 锚点 = 该用户**首个 signup 事件**（任意 source，`installAuthority` 从不过滤 signup——它只管 install 候选集）。若用户没有 signup，退回其**首个满足 installAuthority 的 install 事件**作为锚点；两者都没有则该用户不进任何 cohort。锚点所在的 UTC 自然日 = cohort 日（`cohorts.ts:dayKey`）。
- **channel / os 归因**：一旦锚定，channel 和 os 优先取该用户"任意一条满足 installAuthority 的 install 事件"的值（MMP 归因通常比 signup 自带的 UTM 更可信），即便锚点本身是 signup。只有当用户完全没有合格的 install 事件时才退回 signup 自带的 channel/os（典型场景：纯 web 注册，从未触发任何 MMP install postback）。
- **付费与收入窗口**：付费事件 = `subscription_activated`（不含 `renewal`）。`revenueD0` = 锚点日当天（`dayDiff(cohortDate, occurredAt) <= 0`）的 `subscription_activated` 收入；`revenueD7` = 锚点日起 7 天内（`dayDiff <= 7`）的同类收入。二者都是 `revenueToDate`（无时间上限、含 renewal）的子集，不是替代。
- **D1/D7 完整区间 gate（读侧）**：一个 cohort 的 `cohortDate + N`（UTC）尚未到达"现在"时，它的 D_N 天生结构性为 0——不是"没留存"，是"还没到判定的那一天"。因此 `overview` / `channels` / `summary` 三个读侧路由在聚合 D_N 率之前，用 `kpi-canon.isMatureForRetentionWindow(cohortDate, N, now)` 过滤：不成熟的 cohort 既不进分子也不进分母。这修正了旧版 `overview` 把"太年轻"的 cohort 混进 D7 分母、把汇总 D7 率稀释偏低的 bug。
- **来源=付费/自然**：由 `channels.ts:isPaidChannel(channel)` 推导，不是单独存的字段。
- **OS 归一**：`ios | android | web` 三值（`events.ts:isOs`），前端展示层可以把 `web` 渲成 "PC"，但存储/聚合层统一叫 `web`。各连接器的推导方式：
  - Adjust（`adjust-ingest.ts:normalizeAdjustOs`）：`os_name=ios/android` 直接映射；`os_name` 缺失时若 `device_type=web` 则判 web；其余留 `null`（不猜）。
  - RevenueCat（`revenuecat.ts:osFromStore`）：`store` 字段保守映射——`app_store→ios`、`play_store→android`、`stripe`/`rc_billing→web`；`amazon`/`promotional`/未知 store 留 `null`。
  - `/api/ingest/events`（`ingest-parse.ts`）：只信显式传入的 `os` 字段，且必须是合法值，否则丢弃为 `null`，不做推断。
- **cohort 计数字段**：`CohortSnapshot.installs` 与 `.signups` 现在互斥——同一用户只落在其中一个桶（按锚点类型），`installs + signups` = 该行的锚定用户总数（对内部路由统称"cohortSize"）。旧版只有 `installs` 一个计数，语义等价于现在的 `installs + signups`——所有下游路由（`overview`/`channels`/`cohorts`/`summary`）都已改为用 `installs + signups` 作为速率分母。
- **spend → cohort 归因（growth-sync cron）**：CAC 现在真正非 null 了——cron 按 `Report.platform → 保守 channel 映射`（`google→paid_google_uac`、`meta→paid_meta_web`、`tiktok→paid_tiktok_web`；`adjust`/`appsflyer`/`amazon`/`linkedin` 不映射，spend 计入 `summary[].unallocatedSpend`，不瞎猜）聚合 `${date}|${channel}` 花费，喂给 `buildCohortSnapshots(events, { spendByCohort })`。
- **Report.agency / PlatformAccount.agency**：`reports/sync` 在写 appsflyer/adjust/amazon/linkedin 的 Report 行时，读取对应平台的 `PlatformAccount(orgId, platform, isPrimary=true).agency` 盖章；没有 `PlatformAccount` 行或没设 `agency` 就留 `null`，不猜。adaptor 驱动的 google/meta/tiktok 写入路径（`report-writer.ts`）本次未接入 agency 盖章——留作后续，明确不在本次范围内。**已被 §7 取代**：campaign 级 Report 行现在从 campaign 名解析 agency，`resolveReportAgency`（PlatformAccount 兜底）降级为 fallback。
- **`/api/reports/breakdown` 的 funnel 列**：Report 表没有可以 join 回 CohortSnapshot 的 channel/cohort key，这次只输出投放明细（impressions/clicks/spend/cpc），funnel 相关列固定返回 `null` 且 `funnelJoin: 'pending'`，避免被误读成"已 join、恰好是 0"。**已被 §7 取代**：join key 补上了（channel→platform 桥），funnel 列现在按行填实数。

## 7. campaign 命名 canon 与归因桥（已拍板）

`/api/reports/breakdown` 的 funnel 列在 §6 里是硬编码 `null`/`'pending'`——Report 表当时没有能 join 回 CohortSnapshot 的 key。这一节把 join key 补上，并把"代理商/出价方式/转化目标"这三个维度的权威来源从"没有"变成"campaign 命名规范"。

### 7.1 数据链路 canon（已拍板）

- **激活** = Adjust（决策 A 的 install authority，不变）。
- **注册/留存/付费** = 后端一方事件（signup 锚点 + GA4/RevenueCat，§6 不变）。
- **代理商 / 出价方式 / 转化目标** = 从 campaign 名解析，**不**依赖任何平台 API 字段——这三者是投放团队自己的业务约定，平台 API 不报告，只有 campaign 命名里编码了。
- **OS / 渠道** = 以 MMP（Adjust）自有字段为准（`os_name`/`device_type`、`network_name`）；campaign 名里解析出的 os 仅当 Adjust 字段缺失时才作为 fallback；渠道**从不**用 campaign 名覆盖（`resolveAdjustChannel` 的 `network_name` 优先级不变，`channelHint` 只是自由文本，不解析进 Channel 枚举）。
- **前后端串联** = 注册后回传 Adjust 的用户 id——即现有的 RC `app_user_id` callback parameter 机制（决策 B，§2/§3 已有），本节不引入新机制。

### 7.2 campaign 命名规范

`-` 分段，位置即语义（不足的段留 `null`，超出第 10 段的都归入 `custom`）：

| 位置 | 字段 | 归一规则 | 示例 |
| --- | --- | --- | --- |
| 1 | 代理商 agency | lowercase，无枚举白名单（自定义词表） | `inhouse` |
| 2 | 时间 date | 校验 8 位数字 `YYYYMMDD`，不合法则该字段 `null`（原文保留在 `dateRaw`） | `20260512` |
| 3 | 出价方式 bidStrategy | lowercase，无枚举白名单 | `mai` |
| 4 | OS os | 归一 `ios\|android\|web`（大小写不敏感），认不出则 `null`（原文保留在 `osRaw`） | `Android` → `android` |
| 5 | 地区 regions | 按 `/` 拆成数组，可多值 | `US/T1/JP` → `["US","T1","JP"]` |
| 6 | 渠道提示 channelHint | 原文保留，**不**解析进 Channel 枚举（真正的渠道归因仍是 `resolveAdjustChannel` 走 `network_name`） | `Google` |
| 7 | 编号 index | 原文保留 | `01` |
| 8 | 产品名 product | 原文保留 | `Luddi` |
| 9 | 转化目标 goal | lowercase，无枚举白名单 | `install` |
| 10 | 人群定向 audience | 原文保留 | `female` |
| 11+ | 自定义 custom | 原文保留，按序放入数组 | `Davis-xx` → `["Davis","xx"]` |

完整例子：`inhouse-20260512-mai-Android-US/T1/JP-Google-01-Luddi-install-female-Davis-xx`

解析器：`src/lib/growth/campaign-name.ts:parseCampaignName`（纯函数，任何输入不抛错；空串/无 `-` 的名字/非字符串 → `null`）。

### 7.3 agency 优先级链

`ConversionEvent.agency` / `CohortSnapshot.agency`（Adjust 路径）：

1. `parseCampaignName(campaign_name).agency`
2. 缺失或解析失败 → `null`（不猜）

`Report.agency`（campaign 级行，`report-writer.ts:writeCampaignReports`）：

1. `parseCampaignName(row.campaignName).agency`（每行按各自的 campaign 名解析，最具体）
2. campaign 名缺失/不解析 → `resolveReportAgency(orgId, platform)`（`PlatformAccount.agency`，org/platform 级兜底，§6 原有实现，现降级为 fallback）
3. 两者都没有 → `null`

`bidStrategy` / `conversionGoal` 只在 `ConversionEvent`（Adjust 路径）落地，不在 Report 上——Report 是媒介消耗表，这两个维度属于归因/转化语义，不属于投放消耗语义。

### 7.4 funnel↔投放桥的 join key

`/api/reports/breakdown` 现在把 Report 行和 CohortSnapshot 行按 `(date, os, platform, agency)` 四元组 join：

- Report 侧：`date`/`os`/`platform`/`agency` 直接是列值。
- CohortSnapshot 侧：`channel` 先经 `channels.ts:channelToPlatform()` 映射成 Report 用的平台字符串（`paid_google_uac→google`、`paid_meta_web`/`paid_meta_ios→meta`、`paid_tiktok_web`/`paid_tiktok_ios→tiktok`、`paid_asa→apple_search_ads`；`organic`/`kol`/`referral`/`seo`/`aso` 等 earned 渠道 → `null`，永不参与 join，不是"join 到 0"）。
- 聚合公式（signups/costPerSignup/d1Rate/d7Rate/d0Roi/d7Roi）复用 `kpi-canon.ts` 新增的 `aggregateCohortWindow`（D1/D7 成熟度 gate，同 §6 的 `isMatureForRetentionWindow`）+ `computeFunnelMetrics`（costPerSignup/roi 公式）——`/api/growth/summary` 与 `/api/reports/breakdown` 现在共用这两个纯函数，避免两个视图的公式各自漂移。
- 响应级 `funnelJoin: 'full' | 'partial' | 'none'`（不是逐行字段）：按 Report 侧分组的 join 命中率算，`'full'` = 全部分组都 join 上，`'none'` = 一个都没 join 上（含没有 Report 行的平凡情形），否则 `'partial'`。前端仅在 `funnelJoin !== 'full'` 时显示表头的"pending"提示。
- 单行 join 不上时，该行 funnel 列（signups/costPerSignup/d1Rate/d7Rate/d0Roi/d7Roi）固定 `null`——不是 0，避免"join 到 0"和"没 join"两种情况在 UI 上分不清。

### 7.5 已知限制

- campaign 名不遵守本规范（段数不够、非法日期、认不出的 OS 文本等）的行，对应字段留 `null`，不会报错也不会被丢弃——只是拿不到那个维度。
- `channelHint`（campaign 名第 6 段）是自由文本展示字段，**不**参与任何归因判定；真正决定 Channel 枚举的仍然只有 `resolveAdjustChannel` 的 `network_name`（+ campaign 名里的"web"关键字 fallback，§1 洞 2 的既有逻辑，不受本节影响）。
- adapter 驱动的账户级 Report 行（`report-writer.ts:writeAccountReport`，google/meta/tiktok 的 account-level 汇总）本次仍未接入 agency 盖章——`writeAccountReport` 没有单条 campaign 名可解析，仍是 §6 遗留的范围外项。
- Report 侧的 `os` 列对 adapter 驱动的行（google/meta/tiktok campaign/account 级）目前始终是 `null`（没有任何写入路径为它们推导 os）——这意味着这些平台的 breakdown 行只能在 CohortSnapshot 的 os 也是 `null` 时才 join 得上，日常会明显拉低这些平台的 join 命中率。这是现有数据模型的限制，不是本次改动引入的新问题；若要提高命中率，需要先给 adapter 驱动的 Report 行接入 os 推导（超出本次范围）。
