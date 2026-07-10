# 竞品素材流水线落地 Adex 方案(adex 原生)

> Version v2 · 2026-07-10 · 承接 [07-competitor-intel-remix.md](07-competitor-intel-remix.md) Phase 1/2 与 [08-competitor-creative-pipeline.md](08-competitor-creative-pipeline.md)。
> **定位修正(v2)**:整套流程落在 adex 上运行,不是本地工具。本地仓库 `/Users/mt/work/project/github/creative-pipeline` 的角色 = **worker 容器镜像的内核 + 开发调试环境**——工艺脚本已在本地全链路验证(分析→分级→分段路由→brief→Seedance 生成→拼装→qc),现在原样容器化,不重写。

## 1. 整体架构:控制面 + worker 面,都在 adex 的云上

```text
┌─ adex Cloud Run Service(Next.js,现有)────────────────────────────┐
│ 控制面:ingest API · CompetitorCreative/RemixJob 台账 · 分级精排   │
│ (llm.ts 调 Anthropic) · Seedance 生成编排(seedance2.ts,已有) ·    │
│ 竞品面板/审核门 UI · 变体矩阵 · 平台推送 · cron 触发               │
└──────────────┬────────────────────────────────────────────────────┘
               │ Cloud Run Jobs API / Cloud Tasks 触发
┌─ pipeline worker(Cloud Run Job,新增)──────────────────────────────┐
│ 重活批处理:ffmpeg(抽帧/delogo/剪辑/拼装/转码) · whisper-cpp        │
│ (转写/qc 复扫) · tesseract(OCR 定位) —— 镜像 = creative-pipeline   │
│ 脚本 + 工具链,从 GCS 拉媒体、结果写回 DB/GCS                       │
└────────────────────────────────────────────────────────────────────┘
媒体统一落 GCS(adex-data-gameclaw,公开读)——也是 Seedance/Ark 参照素材的 URL 来源
```

原则:**请求-响应的事(API 调用、LLM 调用、任务编排)在 service 进程;分钟级批处理(音视频)在 Job 容器**。Cloud Run Jobs 支持长时任务,ffmpeg/tesseract/whisper-cpp(CPU 推理)容器化无障碍;service 与 job 共享同一 Cloud SQL + GCS。

## 2. 各环节设计

| # | 环节 | 跑在哪 | 触发 | 输入 → 输出 | 人的位置 |
| --- | --- | --- | --- | --- | --- |
| ① | 采集 | 人(浏览器插件,07 §5-B 桥接) + service | 人收集后上传 | AppGrowing 素材 → `POST /api/ingest/competitor`(元数据+AppGrowing AI 分析) + 媒体上传 GCS → `CompetitorCreative` + `Asset` | 收集与精选 |
| ② | 拆解分析 | **analyze worker**(Job) | ingest 后由 service 派发(Cloud Tasks/cron 扫 pending) | GCS 媒体 → 四件套(metadata/关键帧拼图/转写/OCR 品牌定位)写回 DB 字段 + 拼图入 GCS。AppGrowing 自带 AI 分析优先,本地转写主要做品牌定位与真值校验(08 §3 双分析层) | 无 |
| ③ | 分级路由 | service(llm.ts 多模态) | ②完成即触发 | 拼图 URL+转写+OCR 命中 → `level_v2` + `segment_plan` + five_aspect 存 `CompetitorCreative` | 面板上批量抽检改错 |
| ④a | L1/L2 改造 | **edit worker**(Job) | 面板确认后建任务 | segment_plan → delogo/剪尾/重组/换尾帧插槽 → 成片入 GCS + `Creative(reviewStatus:'pending')` | 确认哪些条目投产 |
| ④b | L3 生成 | service 编排 + Ark | `RemixJob` 状态机 | brief(service 调 LLM 生成,lint 过)→ sample-first 两镜 → 人审 → 全片各 remake 段 → Seedance API(参照素材用 GCS URL) | sample 过审;花钱确认(条数护栏在 RemixJob 上限) |
| ④c | 拼装 | **edit worker**(Job) | ④b 各段就绪后 | reuse 段实切 + 生成段 + 尾帧插槽 → 1080×1920 归一拼接 | 无 |
| ⑤ | qc 预检 | worker(Job 内串联) | ④a/④c 产出即跑 | 品牌词声轨/OCR 复扫 → 结果附在 Creative 上供审核人看 | 无 |
| ⑥ | 审核→投放 | service(现有) | — | `/creatives/review` 人工终审 → 变体矩阵 → push | **IP/授权终审,不自动化** |

失败处理通则:worker 任务带状态机(queued/running/done/failed+error),失败不静默重试超过 1 次,超限落 `needs_attention` 由面板展示;所有花钱动作(Seedance/AppGrowing 点数)前置护栏 + 记账(沿用 RemixJob.aiPointsSpent / spend 台账)。

## 3. 落地顺序(PR 路线)

| PR | 范围 | 状态 |
| --- | --- | --- |
| **#1 feat/competitor-intel** | `CompetitorCreative`(+segmentPlan)/`RemixJob` 模型+迁移 · `POST /api/ingest/competitor`(HMAC 幂等,媒体→GCS) · `GET /api/competitors` · seedance2.ts 实战修复(`content.video_url`、整数 duration) · 设计文档 07/08/09 入库 · e2e smoke | 进行中 |
| **#2 pipeline worker 镜像** | `worker/Dockerfile`(ffmpeg+whisper-cpp+tesseract+creative-pipeline 脚本) · analyze/edit 两个 entrypoint · Cloud Run Jobs 部署配置 · service 侧派发 API(`POST /api/competitors/[id]/analyze` 等)+ cron 扫描 | 待 #1 |
| **#3 分级与 Remix 编排** | llm.ts 加多模态 `completeWithMedia`(07 §2.4 预留项) · 分级精排接 ③ · `POST /api/creatives/remix`(RemixJob 状态机:brief→lint→sample→全片→拼装派发) · 生成条数/预算护栏 | 待 #2 |
| **#4 竞品面板 UI** | 列表/筛选/分级抽检改错/任务状态/qc 结果展示,挂进 dashboard | 待 #1(可与 #2/#3 并行) |

本地仓库后续动作:抽出 `worker/` 结构供 #2 直接 COPY;保留本地 CLI 作为开发调试入口(同一套代码两个入口,不分叉)。

## 4. 成本口径(2026-07-10 校准)

Ark 按 video token 计费(`宽×高×fps×时长/1024`),实测 5s@720p = 108,900 tokens(任务 `cgt-20260710153030-s5t5x`)。按 Seedance 1.0 pro 公开价 ¥15/M 估:**5s ≈ ¥1.6**;25s 成片分段路由只生成 remake 段(~12s)≈ ¥4,含 sample-first 试错 **¥10–30/条 L3 成片**;L1/L2 成片 ≈ ¥0.5(仅分级 LLM)。月估(入库 200 条,产出 40 L1/L2 + 12 L3)≈ **¥400–600/月**;Cloud Run Jobs 计算费(CPU 批处理,分钟级)月估另加 ¥50–200,量级不变。待真实账单校准 Seedance 单价常量。

## 5. 模型分层(什么自动走 / 什么升级)

- **零 LLM 全自动**(~80% 环节):四件套、规则预筛、prompt lint、ffmpeg 改造拼装、qc。有确定性算法就不请模型。
- **Sonnet 标准档(默认,勿降 Haiku)**:分级精排/segment_plan/brief。这是路由决策——判错的下游代价(IP 漏判、误走 L3 白花生成费、真人脸误判被 Ark 拒单)远超省的几毛钱,且 IP/真人脸判定吃视觉能力。
- **升级 Opus 档的判据 = 决策下游花钱或不可逆**:① 要投真钱的头部 L3 结构的 brief 精修;② lint 两轮不过/人审两次打回的失败复盘(问题在理解层,换强模型重写而非同档重试);③ "已充分转化"边界案例的法务风险独立意见(人终审);④ 新产品/赛道接入时的一次性设计决策。升级本身便宜(单次几元),真正贵的是 Seedance 重生成与人工返工——LLM 质量花在能避免这两样的地方。
- **人工必须**:采集、分级抽检、sample 过审、IP/授权终审、放量决策(与 [05-cuddler-playbook.md](05-cuddler-playbook.md) §6 一致)。
