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

## 2. 两个先拍板的口径决策（代码之前）

- **决策 A · install 权威源**：接了 MMP 的 org，install 与渠道归因以谁为准？推荐：**MMP 为 install 权威，GA4 只供 first_chat / scene_generated 等 MMP 不报的漏斗深层事件**。定了写进 `kpi-canon.ts`（如 `installAuthority` 配置）并在本文件记录。
- **决策 B · userKey 统一方式**：能否让客户在 MMP callback 里透传 RC app_user_id？能 → 全链路统一；不能 → namespace 前缀方案，此时留存/LTV 仍以 GA4/RC 体系计算，MMP 只贡献 install 计数与渠道校正（注意留存分子分母必须同 userKey 体系，否则错配）。

## 3. 接入步骤（Adjust，S2S callback 方案）

**不推荐**用 Report Service API 拉聚合造合成事件——聚合行没有 userKey，进不了 cohort。

1. **堵洞（代码前置）**
   - `src/lib/growth/cohorts.ts`：`RawEvent` 加 `source`，聚合按决策 A 单源过滤 install 类事件；`growth-sync` cron 的查询同步加 `source` select
   - `src/lib/growth/channels.ts`：加 `ADJUST_NETWORK_MAP: Record<string, Channel>` + `resolveAdjustChannel(networkName, campaignName)`（映射表按客户实际 network 命名维护）
   - 新建 `src/lib/growth/adjust-ingest.ts`：`mapAdjustCallback(payload) → ConversionEventInput` 纯函数，照 `ga4.ts:mapGa4Event` 的写法；Adjust `activity_kind`（install/event/reattribution）+ 自定义 event token → canonical `EventName`（`events.ts` 闭集白名单，透传会被 drop）
   - 测试必须含**双源用例**：同一 userKey 的 GA4+Adjust install 经聚合后不翻倍（现有 cohorts.test.ts 全是单源，这正是洞 1 测不出来的原因）
2. **鉴权路由**：Adjust callback 是 URL 模板，算不了 per-request HMAC，两选一：
   - 新建 `POST /api/ingest/adjust?org=<id>`，静态密钥 + `verifyBearer`（完整模仿 `src/app/api/ingest/revenuecat/route.ts`，密钥存 `PlatformAuth(platform='ingest')`；Adjust 侧密钥放 callback URL 查询参数，路由内 `verifyBearer` 常时比较）
   - 或客户后端收 callback 后签 HMAC 转发到现有 `/api/ingest/events`（复用全部现有鉴权，代价是多一跳客户侧工程）
3. **Adjust 后台配置**：Raw Data Exports → Real-time callbacks，install + 关键 event 各配一条，URL 带 placeholder：`{activity_kind}`、`{network_name}`、`{campaign_name}`、`{adid}`、`{idfa}`、`{created_at}`、`{country}`，及透传的 partner parameter（决策 B 的 app_user_id）
4. **验证清单**：同一 callback 重放两次只落一行（幂等键）；ASA/Meta 的 network 名映射进正确 channel（不落 organic）；GA4+Adjust 双开的 org 在 `/growth` 的 installs 与单开 MMP 一致；`/dashboard` 的 Report.adjust 总量不受影响

## 4. AppsFlyer 附注

同构接入：Push API（S2S 实时回传）对应 Adjust callback，`pid/c` 字段对应 `network_name/campaign_name`（需 `APPSFLYER_NETWORK_MAP`），设备标识 `appsflyer_id` 同样是独立命名空间——三个洞和两个决策**一字不差地适用**。旧链路 `getInstallReport`（`groupings=date,pid`）同样保留不动。

## 5. 涉及文件速查

| 动作 | 文件 |
| --- | --- |
| 新建 mapper | `src/lib/growth/adjust-ingest.ts`（+测试） |
| 新建路由（方案一） | `src/app/api/ingest/adjust/route.ts` |
| 改：channel 映射 | `src/lib/growth/channels.ts` |
| 改：单源聚合 | `src/lib/growth/cohorts.ts`、`src/app/api/cron/growth-sync/route.ts` |
| 改：口径记录 | `src/lib/growth/kpi-canon.ts`、本文件 §2 |
| 不动 | `src/lib/platforms/adjust.ts` / `appsflyer.ts`、`reports/sync`、`/api/ingest/events` 鉴权、`ingest-parse.ts`（`source='adjust'` 已注册） |
