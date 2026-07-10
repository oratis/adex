# 竞品素材流水线 ↔ Adex 接入方案

> Version v1 · 2026-07-10 · 承接 [07-competitor-intel-remix.md](07-competitor-intel-remix.md) Phase 1/2 与 [08-competitor-creative-pipeline.md](08-competitor-creative-pipeline.md) §7。
> 本地工艺层代码在 `/Users/mt/work/project/github/creative-pipeline`(独立 git 仓库,已全链路验证:分析→分级→分段路由→brief→Seedance 生成→拼装→qc)。

## 1. 分工边界(为什么不全搬进 adex)

| 层 | 跑在哪 | 理由 |
| --- | --- | --- |
| 采集(AppGrowing 桥接收集)、四件套分析(whisper/tesseract/ffmpeg)、分级、brief、剪辑拼装、qc 预检 | **本地 creative-pipeline** | 依赖本机重型工具链(whisper-cli/tesseract/ffmpeg-full),Cloud Run 容器不适合跑;素材文件大,本地处理零传输成本 |
| 竞品情报库(CompetitorCreative)、素材库(Asset+GCS)、Remix 任务台账(RemixJob)、Seedance 生成编排、人工审核门、DCO 变体矩阵、平台推送 | **adex** | 团队共享资产、审核流程、投放链路本来就在 adex;07 §2 已确认 90% 下游现成 |

接口:本地 pipeline 产出 → **HMAC 推送** adex ingest API;媒体文件 → **GCS**(`adex-data-gameclaw`,公开读,上传即得公网 URL——Seedance/Ark 参照素材直接用这个 URL,已实测 bucket 可访问)。

## 2. 数据流

```text
AppGrowing(浏览器插件收集,B桥接)
  → 本地落盘 → analyze/classify/classify_llm(segment_plan)
  → push_to_adex.py:
      媒体+关键帧拼图 → GCS(uploads/competitor/…)
      元数据+分析JSON → POST /api/ingest/competitor(HMAC,按 externalId 幂等)
  → adex: CompetitorCreative 行 + Asset 行(source:'appgrowing')
  → 人在 adex 竞品面板筛选"值得做"的条目 → 建 RemixJob
  → 本地拉 brief/生成/拼装(或 adex 直接调 Seedance——render seam)
  → 成片回传 GCS + Creative(source:'remix', sourceRef=externalId, reviewStatus:'pending')
  → /creatives/review 人工审核门 → 变体矩阵 → push
```

## 3. PR #1 范围(feat/competitor-intel)

1. **Prisma 模型**(07 §4 提案,均为新增不动既有):`CompetitorCreative`(含 `segmentPlan Json?`——07 提案之后新增的分段路由字段)+ `RemixJob` + migration。
2. **`POST /api/ingest/competitor?org=`**:克隆 `ingest/scenes` 的 HMAC + 幂等模式;body 为一条或多条 `{externalId, 元数据, analysis(five_aspect/segment_plan/level_v2/…), mediaUrl?, keyframeUrl?}`;`mediaUrl` 为 GCS URL 时直接挂 Asset,为外链时 fetch→uploadToGCS。
3. **`GET /api/competitors`**:按 org 列表/筛选(level/material_type/adDays 排序)。
4. **seedance2.ts 实战修复**(首次真实调用发现,见 creative-pipeline commit e06e215/1224f1c):
   - 任务响应的视频 URL 在 `content.video_url`,不是现在假设的 `output.video_url`(doubao-seedance-2-0-260128 实测);
   - `duration` 必须整数秒(浮点返回 400 InvalidParameter)。
5. **设计文档入库**:docs/growth/07、08、09(本文档)。
6. e2e smoke:新 ingest/competitors 路由 happy path。

**不在本 PR**:每日自动同步 cron(Phase 3)、Remix 引擎 API(`/api/creatives/remix`,等本地工艺跑出足够量再抽象)、竞品面板 UI(先 API,面板下个 PR)。

## 4. 本地侧配套(creative-pipeline 仓库,PR 合并后做)

- `push_to_adex.py`:读批次产物 → gcloud/GCS 上传媒体 → 调 ingest API(HMAC key 经 hakko-secret)。
- `seedance_gen.py --ref-video` 直接吃 GCS URL(已支持 URL,无需改)。

## 5. 成本口径(2026-07-10 校准)

Ark 按 video token 计费(`宽×高×fps×时长/1024`),实测 5s@720p = 108,900 tokens。按 Seedance 1.0 pro 公开价 ¥15/M 估:**5s ≈ ¥1.6**;25s 成片走分段路由只生成 remake 段(~12s)≈ ¥4,含试错 ¥10–30/条。待用真实账单(任务 `cgt-20260710153030-s5t5x`)校准单价常量。
