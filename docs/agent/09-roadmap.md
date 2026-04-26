# 09 · 实施路线图

> 承接现有 Phase 9，规划 Phase 10–17，预计 14–18 周（单 senior 工程师 + AI/PM 各 0.3 投入）。

## 总览

| Phase | 主题 | 预计 | 退出标准 |
|---|---|---|---|
| **P10** | 执行层补全（断链 A/B/C） | 2 周 | launch 真正推 targeting + ad；status 双写；PlatformLink 落地 |
| **P11** | Report campaign 粒度 | 1.5 周 | sync 写 level=campaign；dashboard 不回归 |
| **P12** | 双向同步 + Snapshot | 2 周 | 平台后台改 status，1h 内本地反映；drift 告警 |
| **P13** | Agent Runtime（shadow 模式） | 2.5 周 | 8 个 tool 接入；shadow 跑 1 周稳定，30 个 eval pass ≥ 90% |
| **P14** | Guardrails + 审批队列 | 2 周 | 12 类 guardrail；审批 UI；自动回滚 |
| **P15** | 创意自动化 + A/B 实验 | 2.5 周 | rotate_creative + start_experiment 上线；统计显著性可信 |
| **P16** | L3 半自治模式 + 高风险 tool | 2 周 | 5 个高风险 tool；首批 3 个客户切 autonomous 模式 |
| **P17** | 决策回看 + Prompt 版本化 + Backtesting | 2 周 | DecisionOutcome 满 30 天数据；prompt v2 上线流程跑通 |

---

## Phase 10 · 执行层补全

**目标**：消除「Adex 暂停 ≠ 平台暂停」「launch 后还要去平台手填 80%」的根本问题。

### 工作项
1. 写 `PlatformAdapter` 接口 + `BaseAdapter` 基类（`src/lib/platforms/adapter.ts` / `base-adapter.ts`）
2. 新增 `PlatformLink` 表 + 迁移
3. 重构 `GoogleAdsAdapter`（含 createAdGroup / createAd / push targeting / push status / push budget）
4. 重构 `MetaAdsAdapter`（含 AdSet + targeting + status + budget）
5. 重构 `TikTokAdsAdapter`（同上）
6. 改造 `POST /api/campaigns/[id]/launch` → 走 adapter，并写 PlatformLink
7. 改造 `PUT /api/campaigns/[id]`（status / budget 变更）→ 走 adapter
8. 改造 `POST /api/advisor/apply`（pause/resume）→ 走 adapter
9. 数据回填脚本：把现有 `Campaign.platformCampaignId` 等字段灌进 `PlatformLink`

### 验收
- e2e：在 Google Ads test account 上，UI 创建 → launch → 平台后台真实出现 campaign + ad group + ad，status=PAUSED，targeting 全部正确
- e2e：UI pause → 平台 API 真实切 PAUSED
- 旧数据回填后，dashboard 列出的所有 active campaign 都有对应 PlatformLink
- `tsc --noEmit` + lint 通过

### 交付物
- 3 个 PR：adapter 框架 / Google adapter / Meta + TikTok adapter
- 1 个迁移：`phase_10_platform_link`
- 文档：[05-execution-layer.md](./05-execution-layer.md) 实现验证

### 风险
- Google Ads API v23 关于 ad group / ad creation 的字段变化（需 read `node_modules/next/dist/docs/` 类文档？不，是 Google API docs）→ 先做 sandbox spike 1 天
- Meta `special_ad_categories` 在某些行业必须填 → 暂时 hardcode `[]` + 文档标注

---

## Phase 11 · Report campaign 粒度

**目标**：让 Agent 能基于「具体哪条 campaign 表现差」做决策，而不是只看平台总数。

### 工作项
1. Schema 改造：`Report` 加 `level` / `campaignLinkId` / `adGroupLinkId` / `adLinkId`，主键改 cuid + 复合 unique
2. sync handlers 改造：`syncGoogle / syncMeta / syncTikTok` 写两套（account + per-campaign）
3. Dashboard 兼容：仍读 `level=account`
4. Advisor / Agent 优先读 `level=campaign`
5. 索引：`(campaignLinkId, date)`
6. 数据保留 cron：90 天清 ad-level、13 月清 campaign-level

### 验收
- sync 后 Report 表同时有 account + campaign 行
- 单个 campaign 能查 7 天指标曲线
- 现有 dashboard 数字与改造前完全一致（snapshot 测试）
- p95 sync 时间 < 30s

### 交付物
- 1 个 PR
- 1 个迁移：`phase_11_report_campaign_level`
- 性能基线报告

### 风险
- 大账号（>1000 campaigns）一次 sync 写入量爆炸 → 改用 batch insert + 控制 query 深度

---

## Phase 12 · 双向同步 + Snapshot

**目标**：Agent 决策的"事实基线"始终新鲜；用户在平台后台的手动改动 1h 内同步回本地。

### 工作项
1. 新增 `CampaignSnapshot` 表
2. Sync Worker 拆分：cron 每小时入队 `sync.account` × 每个活跃 org-platform
3. 接入 Cloud Tasks（或先用 setTimeout + leader election 单实例方案过渡）
4. Drift detection：snapshot 与 `Campaign.desiredStatus` 比对，4 种 case 处理（见 [05-execution-layer.md §5.2](./05-execution-layer.md)）
5. `Campaign.syncedStatus / syncedAt / syncError` 字段
6. UI：Campaign 详情页显示「期望 vs 实际」差异
7. Manual sync 按钮 → 立即入队 + 1min 去重

### 验收
- 在 Google 后台手动暂停一个 campaign，1 小时内本地 syncedStatus=paused
- managedByAgent=true 的 campaign 出现 drift 后自动创建 PendingApproval
- sync.account 任务 p95 < 30s
- 队列堆积 alert 配好（> 100 任务超 5 分钟未消费）

### 交付物
- 1 个 PR（队列基础设施）+ 1 个 PR（drift 逻辑）
- 1 个迁移：`phase_12_snapshot_drift`
- runbook：sync 队列异常排查

### 风险
- Cloud Tasks 引入运维复杂度 → P12 先用单实例 in-process queue + advisory lock，P14 再切 Cloud Tasks

---

## Phase 13 · Agent Runtime（shadow 模式）

**目标**：Agent 主循环跑通，仅记录决策不真实执行；上线 8 个低/中风险 tool。

### 工作项
1. `src/lib/agent/` 目录骨架（loop / perceive / plan / act / verify / guardrails / tools/ / prompts/）
2. 数据：`Decision` / `DecisionStep` / `DecisionOutcome` / `Guardrail` 表 + 迁移
3. Anthropic Tool Use API 接入（替换现 `completeJSON`）
4. Plan v1 prompt（[06-agent-loop.md §3.1](./06-agent-loop.md)）+ prompt caching
5. 8 个 tool 实现：pause_campaign / resume_campaign / adjust_daily_budget / pause_ad_group / pause_ad / rotate_creative / flag_for_review / noop
6. Mode = `shadow`：所有 tool 不真调 adapter，仅写 DecisionStep.status=skipped
7. Cron：每小时跑一次 plan-act-loop（仅对 enabled org）
8. Verify cron：每天 4am UTC 跑 outcome 分类
9. UI：`/decisions` 列表 + 详情
10. LLM Eval framework + 30 个 fixture，CI 集成

### 验收
- 至少 5 个内测 org 切到 shadow 模式跑 1 周
- 每个 org 产出 ≥ 50 个 Decision
- LLM eval pass rate ≥ 90%
- DecisionStep parse 错误率 < 2%
- 单 plan() 调用平均成本 < $0.05
- 所有 8 个 tool 的 unit test 100% pass

### 交付物
- 多个 PR（拆 5–7 个）
- 1 个迁移：`phase_13_agent_decisions`
- prompt v1 + 30 eval fixtures
- 内部 demo + 决策样例 walkthrough

### 风险
- LLM 输出格式不稳 → 强制 Tool Use（schema 校验在 API 层）
- prompt 注入（恶意 campaign name）→ schema 严格校验，恶意输入只能影响 noop
- Anthropic 月成本失控 → 先按 org 设 $50/月硬上限

---

## Phase 14 · Guardrails + 审批队列

**目标**：从 shadow 升级到 approval_only（L2）模式，所有决策走人工审批。

### 工作项
1. 12 类 guardrail evaluator（[07-safety.md §2](./07-safety.md)）
2. `PendingApproval` 表 + 迁移
3. 审批 UI：`/approvals` 列表 + 详情卡片 + bulk 操作
4. 通知：email + Slack webhook
5. 过期 cron：72h 自动 reject + 通知
6. Kill Switch UI + 后端
7. 自动回滚：reversible tool 的 inverse 注册表
8. Mode = `approval_only`：所有 decision 强制 requires_approval=true
9. 审批响应时间指标采集

### 验收
- 内测 org 切 approval_only，跑 2 周
- 审批响应中位数 < 4h
- guardrail 阻止决策的占比有合理分布（10–40%）
- 自动回滚 e2e 测试通过
- Kill switch 触发后所有 cron 立即跳过

### 交付物
- 多个 PR
- 1 个迁移：`phase_14_guardrails_approvals`
- Slack 集成文档
- 审批操作 runbook

### 风险
- 审批疲劳 → bulk 操作 + 智能默认（重复同类型 decision 一键 approve N 个）
- guardrail 配错把 Agent 锁死 → 提供「重置默认 guardrail」按钮

---

## Phase 15 · 创意自动化 + A/B 实验

**目标**：从「调状态/预算」升级到「换创意/做实验」。

### 工作项
1. 创意 → 平台 ad 推送链路（`uploadCreativeAsset` + `createAd` + 写 PlatformLink）
2. 5 个新 tool：start_experiment / conclude_experiment / clone_campaign / generate_creative_variant / push_creative_to_platform
3. `Experiment` / `ExperimentArm` 表 + 迁移
4. 实验调度：start_experiment 复制 ad group + 50/50 流量
5. 显著性检验：simple z-test / Bayesian（先选 z-test）
6. 创意 review UI：LLM 生成的 creative 必须 admin 标记 approved 才能 push
7. 平台政策违规处理：creative 被 reject → 标记 + 通知

### 验收
- 完整跑通：低 CTR 检测 → 生成新 creative → 人工 review → push → 实验 → conclude
- 实验显著性 false positive rate < 10%（用 simulation 验证）
- 至少 3 个真实账号产出有效实验

### 交付物
- 多个 PR
- 1 个迁移：`phase_15_experiments`
- 实验设计 runbook（如何写好 hypothesis）

### 风险
- 平台对快速 ad 创建/暂停的频率限制 → adapter 内集中限流
- A/B 显著性误判 → 严格 min_sample 校验 + 多次模拟验证

---

## Phase 16 · L3 半自治 + 高风险 tool

**目标**：少数账号正式切 autonomous 模式；上线 4 个高风险 tool。

### 工作项
1. 4 个高风险 tool：adjust_bid / adjust_targeting_geo / adjust_targeting_demo / enable_smart_bidding
2. Mode = `autonomous`：guardrail 通过则不需审批
3. 严格的高风险 guardrail 默认值（参考行业经验，每个 tool 单独设）
4. 「连续 3 个 regression 自动降级到 shadow」机制
5. Agent 周报自动邮件
6. 白名单制度：autonomous 模式仅对手动开启的 org 可用
7. 法务文案：用户协议 + 责任界定
8. Onboarding：新 org 强制走 shadow → approval_only → autonomous 升级流程

### 验收
- 3 个友好客户跑 autonomous 模式 4 周
- 这 3 个客户的 outcome regression rate < 10%
- 周报 NPS ≥ 8
- 没有发生需要 kill switch 的事件

### 交付物
- 多个 PR
- 法务签字版用户协议更新
- onboarding 文档

### 风险（最高）
- 真实账号亏钱 → 严格白名单 + 预算硬上限 + 异常实时告警
- 客户失去对账号的"控制感" → 周报 + 实时通知 + 一键暂停 Agent

---

## Phase 17 · 决策回看 + Prompt 版本化 + Backtesting

**目标**：Agent 自我进化的基础设施；让 prompt 升级有数据支撑。

### 工作项
1. `PromptVersion` / `PromptRun` 表 + 迁移
2. Prompt 加载器：从 `src/lib/agent/prompts/agent.plan/v{N}.md` 读
3. A/B prompt 流量切分：按 orgId hash 分配 default vs experimental
4. PromptRun → outcome 关联报表
5. Backtesting 工具：从历史 perceive snapshot 重放 prompt v_new，对比 v_old 决策差异（不实际执行）
6. CI gate：PR 改 prompt → 自动跑 eval + backtest，pass rate 下降 > 5pp 阻止合并
7. 「Decision 详情」UI 加上：prompt 版本、原 LLM 输出、cost、tokens

### 验收
- 至少 1 次 prompt v1 → v2 切换走完完整流程（experimental → 10% → 50% → default）
- backtest 工具能重放 30 天历史
- 月度 LLM 成本 dashboard 上线

### 交付物
- 多个 PR
- 1 个迁移：`phase_17_prompt_versioning`
- prompt 升级 SOP

### 风险
- backtest 不能完全模拟外部市场变化 → 文档明确 backtest 是参考不是结论

---

## 依赖关系图

```
P10 ──┬── P11 ──┬── P12 ──┬── P13 ──┬── P14 ──┬── P15 ──┬── P16 ──── P17
      │         │         │         │         │         │
      │         │         │         │         │         │
      └─ 必须 ──┘         └─ 必须 ──┘         └─ 推荐 ──┘
                                                         
P10–P12 是基础设施（必须串行）
P13–P14 是 Agent 主体（必须串行）
P15 创意自动化（可与 P14 部分并行，但必须在 P13 后）
P16 半自治（必须在 P14 后）
P17 学习层（与 P15/P16 并行 OK）
```

## 资源配置建议

| 角色 | 投入 | 工作 |
|---|---|---|
| Senior Backend | 1.0 FTE | 全程，主导执行层 / Agent Runtime |
| Frontend | 0.4 FTE | P14 审批 UI / P17 决策 UI |
| AI/Prompt Eng | 0.3 FTE | P13/P15/P17 prompt + eval |
| PM | 0.3 FTE | guardrails 默认值调研、客户访谈、onboarding 流程 |
| 法务 | 0.05 FTE | P16 用户协议 |
| SRE | 0.2 FTE | P12 队列 / P14 alerting / P16 监控 |

总计约 **2.25 FTE × 4 个月 = 9 人月**。

## Go/No-Go 决策点

每个 Phase 末尾设决策点：

- **P10 后**：执行层稳定？如否 → 不进 P11
- **P12 后**：双向同步可信？如否 → 不进 P13（Agent 决策依赖 sync 准确）
- **P14 后**：审批响应可接受？如否 → 不进 P16（不能跳过 L2 直接 L3）
- **P16 中期**：autonomous 客户出现 ≥ 1 次显著亏损事件 → 立即冻结，回到 P14 整改

## 长期愿景（Phase 17 之后）

- **L4 全自治**：仅在多 quarter 数据证明 outcome regression rate 极低后开放
- **跨平台预算重分配**：基于平台间 ROAS 差异自动迁移预算
- **多账号策略**：单 brand 在多个广告账号下的协同优化
- **自有归因模型**：MTA 替代 last-click，更准确的决策依据
- **Agent marketplace**：让用户/合作伙伴贡献定制 tool
