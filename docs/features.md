# Adex 是什么

> 一个让 AI 帮你管广告投放的平台。你设定预算和目标，它接手日常调优；任何动作都可以人工审批或一键回滚。

线上地址：<https://adexads.com>（邀请制注册）

---

## 一句话介绍

**把投手从"每天盯数据-暂停-加预算-换素材"的循环里解放出来，让 AI 在你设的安全边界内自动完成这些。**

---

## 适合谁

| 你是… | Adex 解决你什么问题 |
|---|---|
| **小团队 / 独立投手** | 没人帮你看夜里 4 点的 ROAS，AI 帮你在预算超支前一秒暂停那条爆雷的 campaign |
| **DTC 品牌主** | 同时跑 Google + Meta + TikTok，每天切换 5 个后台，Adex 一个面板看全 |
| **代运营机构** | 给每个客户一个独立 workspace，团队权限隔离，决策全留 audit 日志，对账有据 |
| **游戏 / app 推广** | 接 AppsFlyer / Adjust 把回传数据拉进来，按真实 LTV/CPI 调价，不再只看平台口径 |

**不太适合**：单条 campaign 月预算 < $200 的小卖家——AI 调优至少需要每条 campaign 每天 100+ 转化才能跑出可信信号。

---

## 平台能做什么

按你"花在广告上的时间"分四块讲。

### 1. 把所有广告账号合并到一个面板

接一次 OAuth 之后，5 个广告平台 + 2 个 MMP 的 campaign 列表、花费、ROAS 都在 `/dashboard` 一张图里看。

| 平台 | 接的方式 | 你能做什么 |
|---|---|---|
| Google Ads | OAuth + MCC + Developer Token | 创建 / 暂停 / 改预算 / 改 bid / 换 targeting / 拉报表 |
| Meta (Facebook/Instagram) | Access Token + Ad Account | 同上（含 ad set 创建 + 创意上传） |
| TikTok Ads | Access Token + Advertiser ID | 同上 |
| Amazon Ads | Access Token + LWA | 拉报表（写功能逐步开放） |
| LinkedIn Ads | Access Token | 拉报表 |
| AppsFlyer | API Token | 把 install / 转化 / 收入数据合并进 ROAS 计算 |
| Adjust | API Token + App Token | 同上 |

每天凌晨 4 点自动同步，按你的需要也可以手动点 "Sync Data" 立即拉一次。

### 2. AI 创意生成

不会 PS、不会剪片，也能出 10 套素材：

- **图片**：Seedream（豆包文生图），输入"夏季防晒霜，海滩，年轻女性"等描述生成
- **视频**：Seedance2（豆包文生视频 / 图生视频），15s 短视频
- **文案**：Claude 帮你写 headline / description / CTA 的 3-5 个变体

生成后存在 `/creatives` 库里，可以直接关联到现有 ad，或按 review 流程过一遍人工再推到平台。

### 3. AI 广告顾问（Advisor）

进 `/advisor` 点一下，Claude 看完你过去 7 天的指标，给出 3-6 条具体建议，每条带：
- 严重程度（info / opportunity / warning / alert）
- 推荐动作
- 一键 "Apply" 直接执行（仅限 pause/resume，安全的）

适合"我没时间天天看 dashboard，告诉我哪个最该处理就行"的场景。

### 4. 全自动 Agent（核心 / 进阶）

这是 Adex 的主打。

> "Agent" 不是给你个聊天框。它是一个**每小时自动跑的循环**：感知 → 思考 → 行动 → 验证。

每个小时它会：
1. **感知**：把你所有 active campaign 过去 7 天的指标喂给 Claude
2. **思考**：Claude 决定：什么都不做（多数情况）/ 暂停 / 调预算 / 换创意 / 起 A/B 实验 / 让人审批某个高风险动作
3. **行动**：通过 12 类内置 + 你自定义的 guardrail（红线规则）筛一遍，符合的真去打平台 API
4. **验证**：24 小时后对比执行前后的数据，标记每个决策是 success / neutral / regression

**3 种工作模式**，按你的信心阶梯切换：

| 模式 | 行为 | 何时用 |
|---|---|---|
| **shadow** | AI 做完整推理但**不真执行**，所有决策标 "skipped" 写入日志 | 第一周——观察 AI 想做什么，但任何东西都不动 |
| **approval_only** | AI 提议→排队等你点 "Approve"→才执行 | 第二/三周——决策还要看，但不再自己动手 |
| **autonomous** | AI 提议→guardrail 通过→直接执行；只有违规的进审批 | 完全信任后——平台需要 owner 单独 allowlist 才能开 |

**安全网**全部内置：
- 你随时可以一键 **Kill Switch** 让所有 AI 行动停止
- 任何动作都有 audit 日志，鼠标悬停看完整推理过程
- 可逆动作（pause / 改预算 / 改 targeting）支持**一键回滚**——AI 改错了就撤销
- 连续 3 次 verified regression 自动从 autonomous 降到 approval_only

---

## 与其他方案对比

| 你现在 | 痛点 | Adex 怎么解决 |
|---|---|---|
| 手动看每个平台后台 | 切换疲劳 / 错过夜间事件 | 一个面板 + 24/7 自动监控 |
| 用平台原生自动出价 | 黑盒、无法跨平台、改不了规则 | 完全可见、跨平台 ROAS、可配硬规则 |
| 雇代运营 | 月费 ¥3000+、响应慢、动作没追溯 | LLM 月成本 ~$50、立即响应、每条决策可审 |
| 用 Optmyzr / Skai | 学习曲线陡、贵、规则要 IT 写 | 中文文档 / 模板规则 / 邀请制小步推 |
| 自己写脚本 | 改一次平台 API 就崩、不可见 | adapter 层屏蔽平台差异、有 webhook + Slack 通知 |

---

## 安全保障

把"AI 自动花我的钱"这件事拆解到可以放心的程度：

| 担心 | 我们的做法 |
|---|---|
| AI 把日预算调到 $10000 | `budget_max_daily` 内建 guardrail，超过你设的上限**直接拒绝** |
| AI 暂停了我的 winner | `pause_only_with_conversions` 规则——24h 数据样本不够时不允许 pause |
| AI 同一秒里反复改主意 | `cooldown` guardrail——同一动作 4 小时内重复直接 block |
| 半夜搞事 | `agent_active_hours` 限定它的"上班时间" |
| LLM 成本失控 | 月度硬上限 + 实时 dashboard，到 80% 警告 |
| 改错了想回滚 | 可逆动作存了"反操作"，详情页一键 rollback |
| 出大事一键停 | Kill Switch 立即生效，所有 cron 跳过本 org，已挂起的审批仍可处理 |
| AI 的 prompt 改了不放心 | A/B 流量切分（10% 用新版本观察）+ 30 条回归测试 + outcome 关联报表 |

每条规则的具体阈值都可以在 `/guardrails` 里改 / 加 / 删。

---

## 上手节奏

| 时间 | 你做什么 | 平台状态 |
|---|---|---|
| Day 1 | 注册→接 1 个广告平台→建 1 条 test campaign | 全部手动 |
| Day 2-3 | 跑 AI 顾问看建议、采纳几条 | 半自动（你审核） |
| Day 4-7 | 开 Agent shadow 模式观察决策质量 | AI 在看，但不动 |
| Week 2-3 | 切 approval_only，每天花 5min 处理审批队列 | AI 提议，你点 OK |
| Week 4+ | 配好 guardrail，申请进 autonomous allowlist | AI 在你的边界内自驾 |

---

## 价格 / 限制

- **平台本身**：邀请制免费（早期）
- **运行成本**：你只为 Anthropic 的 LLM 调用付费，平均每个 org 每月 $20-$50
- **限流**：手动触发 agent 6 次/小时；snapshot 12 次/小时；自动 cron 不限
- **平台原生 API 限流**：受各家平台限制（Google Ads ~15000 ops/day 等），Adex 不额外限

---

## 下一步

看 [user-guide.md](./user-guide.md) 跟着步骤把第一条 campaign 跑起来。
