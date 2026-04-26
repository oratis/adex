# Adex Agent 化方案

> 目标：把当前的「多平台广告管理控制台」升级为「真正能自主跨平台优化投放的 Agent 系统」。

## 阅读顺序

| # | 文档 | 内容 | 读者 |
|---|---|---|---|
| 01 | [愿景与 Agent 分级](./01-vision.md) | 我们要造什么、不造什么、Agent 自治等级 | 全员 |
| 02 | [现状差距分析](./02-gap-analysis.md) | 当前代码逐文件能力盘点 + 缺口清单 | 工程 / PM |
| 03 | [目标架构](./03-architecture.md) | 模块划分 / 数据流 / 关键抽象 | 工程 |
| 04 | [数据模型演进](./04-data-model.md) | Prisma schema 改动 + 迁移策略 | 工程 |
| 05 | [Platform 执行层](./05-execution-layer.md) | Adapter 重构 / 真正的 launch / 双向同步 | 工程 |
| 06 | [Agent 决策循环](./06-agent-loop.md) | Perceive→Plan→Act→Verify + Tool Catalog | 工程 / AI |
| 07 | [安全与人工审批](./07-safety.md) | Guardrails / 预算上限 / 回滚 / 审批队列 | PM / 法务 |
| 08 | [测试与可观测性](./08-testing-observability.md) | 测试金字塔 / 决策追踪 / 关键指标 | 工程 / SRE |
| 09 | [实施路线图](./09-roadmap.md) | Phase 10–17，每阶段 deliverables 与验收 | 全员 |

## TL;DR

当前完成度约 **25–30%**：感知层（多平台 OAuth + 数据归集 + AI 建议生成）已就绪，但**执行层、决策闭环、双向同步**全缺。

升级路径分 **8 个 Phase**（Phase 10–17，承接现有 Phase 9）：

- **P10–P11 执行层补全**：让 launch / pause / budget 真正打到平台 API；Report 写到 campaign-day 粒度。
- **P12 双向同步**：定时拉平台 status/spent 校准本地。
- **P13 工具集 + Agent Runtime**：把 Advisor 升级为可调用 6 类工具的 Agent，决策循环成型。
- **P14 安全与审批**：guardrails、预算硬上限、人工审批队列、自动回滚。
- **P15 创意自动化**：低 CTR 时自动生成 + 推送新创意，A/B 实验调度。
- **P16 自治模式**：在通过的 guardrails 内进入 L3 半自治。
- **P17 学习与回测**：决策回看、prompt 版本化、效果归因。

预计 **3–4 个月** 单 senior 工程师 + AI/PM 各 0.3，达到 L3 自治可落地。

## 命名约定

- **Agent**：能感知 → 决策 → 执行 → 验证的闭环系统。
- **Tool**：Agent 可调用的离散动作（如 `pause_campaign`、`adjust_budget`）。
- **Decision**：一次「(perceive) → tool call → (verify)」的完整记录，带 traceId。
- **Guardrail**：在 tool 执行前/后强制的安全约束（如「单 campaign 日预算上调≤30%」）。
- **L0–L4**：Agent 自治等级，定义见 [01-vision.md](./01-vision.md)。
