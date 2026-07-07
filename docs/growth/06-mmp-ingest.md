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
| 3 | **userKey 跨源断裂** | 留存 D1/D7 = "同一 userKey 在 +1/+7 有 GA4 行为事件"；RC 收入也靠 userKey join。MMP 的 adid/idfa 与 GA4 pseudo_id、RC app_user_id 是不同命名空间 | MMP 渠道的 cohort **留存和 LTV 假性归零**；同人被当两个 user 重复计 install | 首选：callback 透传 RC `app_user_id` 统一 userKey（需客户侧配置，Adjust partner parameter 支持）；降级：userKey 加 `adjust:` 前缀、承认跨源不 join（见 §2 决策 B） |

## 2. 两个口径决策（已拍板）

- **决策 A · install 权威源**（已拍板）：接了 Adjust 的 org，install 与渠道归因以 `source='adjust'` 为权威；GA4 只供 first_chat / scene_generated 等 Adjust 不报的漏斗深层事件。实现：`kpi-canon.ts:resolveInstallAuthority({ hasAdjustAuth, adjustInstallCount, ga4InstallCount })`——org 存在 `PlatformAuth(platform='adjust')` → `'adjust'`，否则 `'ga4'`。**防归零保险**：若权威源在计算窗口内 install 数为 0 而另一源 > 0（例如 org 只配了 legacy Report 凭证、没接 `/api/ingest/adjust` callback），本次计算回退另一源，并在返回值 `fallback`/`warning` 字段标注，`growth-sync` cron 会把 warning 打进日志。`cohorts.ts:buildCohortSnapshots` 的 `opts.installAuthority` 据此只过滤 ACQUISITION 类事件（install/signup）的来源；漏斗深层/收入事件不受影响。
- **决策 B · userKey 统一方式**（已拍板）：userKey 首选 Adjust callback 透传的 RC `app_user_id`（partner parameter，需客户侧在 Adjust 后台配置）；取不到时降级为 `adjust:${adid}` 前缀，明确承认这条 userKey 跨源不可 join——留存/LTV 仍以 GA4/RC 体系计算，Adjust 只贡献 install 计数与渠道校正。实现见 `adjust-ingest.ts:mapAdjustCallback`。

## 3. 接入步骤（Adjust，S2S callback 方案）

**不推荐**用 Report Service API 拉聚合造合成事件——聚合行没有 userKey，进不了 cohort。

1. **堵洞（代码前置）**——已完成
   - `src/lib/growth/cohorts.ts`：`RawEvent` 加 `source`；`buildCohortSnapshots(events, { installAuthority })` 聚合前按决策 A 单源过滤 ACQUISITION 类事件（install/signup），漏斗深层/收入事件不过滤；`growth-sync` cron 查询同步加 `source` select
   - `src/lib/growth/channels.ts`：新增 `ADJUST_NETWORK_MAP: Record<string, Channel>` + `resolveAdjustChannel(networkName, campaignName)`。ASA 确定性映射；Meta/TikTok 的 install network 名（`Facebook Installs` / `TikTok Installs` 等）保守映射到 `*_ios`（SKAN，低置信度）——Adjust 的 network_name 分不清 web 与 app-install，`campaign_name` 含 "web" 时才改判 `*_web`；未映射网络名 → `organic`/`inferred`。未改动 `resolveChannel` 一行
   - `src/lib/growth/adjust-ingest.ts`（新建 + 测试）：`mapAdjustCallback(params, eventTokenMap?) → ConversionEventInput | null`，照 `ga4.ts:mapGa4Event` 的写法；`activity_kind='install'` → `install`；`='event'` 时查 `eventTokenMap`（event token → canonical `EventName`，映射不到 → drop）；`reattribution`/`session` 等 → drop（返回 null，不抛错）
   - 测试含**双源用例**（`cohorts.test.ts`）：同一真实安装的 GA4 + Adjust 两行（不同 userKey namespace）不设权威时 installs=2（复现洞 1）；设 `installAuthority: 'adjust'` 后 installs=1 且渠道以 Adjust 行为准；另有用例确认 installAuthority 不过滤漏斗深层事件
2. **鉴权路由**——已完成，选定方案一
   - `GET|POST /api/ingest/adjust?org=<id>`（`src/app/api/ingest/adjust/route.ts`），静态密钥 + `verifyBearer`（完整仿 `src/app/api/ingest/revenuecat/route.ts`，密钥存 `PlatformAuth(orgId, platform='ingest').apiKey`，env `INGEST_WEBHOOK_SECRET` 兜底）；Adjust 侧密钥支持 `Authorization: Bearer` 或 `?token=` query（callback 是 URL 模板，设不了自定义 header）；单条映射失败跳过（200 ok, ignored），不 5xx；写入沿用 `createMany` + `skipDuplicates` 幂等
3. **Adjust 后台配置**：Raw Data Exports → Real-time callbacks，install + 关键 event 各配一条，URL 带 placeholder：`{activity_kind}`、`{network_name}`、`{campaign_name}`、`{adid}`、`{idfa}`、`{created_at}`、`{country}`，及透传的 partner parameter（决策 B 的 app_user_id）
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
