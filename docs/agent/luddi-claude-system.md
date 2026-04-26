# Luddi `.claude/` 体系梳理

> 这是 Luddi 项目完整 Claude Code 工程化体系的参考文档。adex 的 `.claude/` 直接以此为蓝本，按 adex 的技术栈做了简化。
>
> 本文档面向：(1) 后续维护 adex `.claude/` 的人；(2) 想把这套体系挪到其他项目的人；(3) 与 Luddi 同步演进时的对照基线。
>
> **路径约定**：除非另说明，下文的相对路径均相对于 Luddi 仓库根目录。

## 1. 总览

Luddi 的 `.claude/` 把 Claude Code 从"会读文件的助手"升级成"带自动化规则、工程化流程、独立子 agent 的协作主体"。核心组件：

```
.claude/
├── settings.json              # 注册 hooks（事件 → 脚本）
├── settings.local.json        # 本地覆盖（不入库）
├── launch.json                # 启动配置
├── scheduled_tasks.lock       # 调度锁（运行时产物）
├── hooks/                     # 7 个 shell 脚本，事件触发
│   ├── pre-bash.sh
│   ├── pre-commit-gate.sh
│   ├── pre-schema-edit.sh
│   ├── post-schema-edit.sh
│   ├── stop-check-tests.sh
│   ├── on-compact.sh
│   └── worktree-symlink.sh
├── rules/                     # 通过 glob 注入到 Claude 上下文
│   ├── schema.md
│   ├── session-safety.md
│   └── testing.md
├── agents/                    # 独立子 agent 定义
│   ├── reviewer.md
│   └── tester.md
├── agent-memory/              # 子 agent 的持久记忆
│   └── tester/                # MEMORY.md + 主题文件
├── commands/                  # 用户可调的 slash command
│   ├── implement.md
│   ├── verify.md
│   ├── review.md
│   └── release-mobile.md
├── skills/                    # command 委托的可复用执行单元
│   ├── implement/SKILL.md
│   ├── verify/SKILL.md
│   ├── review/SKILL.md
│   └── release-mobile/SKILL.md
└── worktrees/                 # 临时分支隔离工作区（运行时）
```

整体设计哲学：**command 做编排（轻量），skill 做执行（可复用），agent 做独立判断（无记忆传递偏见），hook 做强制（语言/工具无关的安全网）**。

## 2. `settings.json` —— hooks 注册中心

`Luddi/.claude/settings.json`

把事件类型和脚本路径绑起来。Luddi 注册了 4 类事件、7 个脚本：

| 事件 | matcher | 脚本 | 作用 |
|------|---------|------|------|
| `PreToolUse` | `Bash` | `pre-bash.sh` | 拦截危险命令、自动清端口 |
| `PreToolUse` | `Bash` | `pre-commit-gate.sh` | git commit 时做格式 + 测试门槛 |
| `PreToolUse` | `Bash` | `worktree-symlink.sh` | worktree 启动时自动 symlink node_modules |
| `PreToolUse` | `Edit\|Write` | `pre-schema-edit.sh` | schema.prisma 写入前要求人工确认 |
| `PostToolUse` | `Edit\|Write` | `post-schema-edit.sh` | schema 改完后提示下一步动作 |
| `Stop` | — | `stop-check-tests.sh` | 收尾时检查改动业务逻辑是否伴随测试 |
| `SessionStart` | `compact` | `on-compact.sh` | 上下文压缩后重新注入 git 状态 |

> **退出码语义**：Exit 0 = 放行；Exit 2 = 阻断（stderr 被回送给 Claude）。timeout 单位毫秒。

## 3. Hooks —— 7 个脚本逐个看

### 3.1 `pre-bash.sh` —— 危险命令拦截 + 端口清理

`Luddi/.claude/hooks/pre-bash.sh`

- **BLOCK**: `git push --force`、`rm -rf /`、`rm -rf apps/`、`rm -rf packages/`、`docker-compose up`（Luddi 强制远程 DB）
- **AUTO**: 命令含 `pnpm.*run dev` / `next dev` / `expo start` 时，自动 `kill -9` 端口 3000/3001/8081/8787 上的僵尸进程
- 通过 stdin JSON 拿 `tool_input.command`，纯 string match

**坑点**：字面量匹配不分上下文 —— `pgrep -fl 'next dev'` 这种"检查"命令也会触发 kill。详见 [`session-safety.md`](#42-session-safetymd)。

### 3.2 `pre-commit-gate.sh` —— commit 质量门槛

`Luddi/.claude/hooks/pre-commit-gate.sh`

仅当命令含 `git commit` 时触发，分两段：

**A. Commit 消息格式校验**
- 强制 `type(scope): summary` 格式
- type ∈ `feat|fix|refactor|perf|style|docs|test|chore|revert`
- scope ∈ `web|api|mobile|api-core|db|shared|ui|harness|deploy`（多包用逗号）
- summary 小写开头、无句号、≤50 字符
- 用 Python 解析 HEREDOC 和 inline `-m` 两种写法

**B. 影响包测试级联**
按 staged 文件路径决定要跑哪些 `pnpm --filter ... run test`：

| 改动路径 | 要跑的包 |
|----------|----------|
| `packages/db/` | api-core + api + web |
| `packages/api-core/` | api-core + api |
| `packages/shared/` | mobile |
| `apps/api/` | api |
| `apps/web/` | web |
| `apps/mobile/` | mobile |

通过 `TESTED` 字符串去重，避免一个包跑两次。每个包 60s timeout。失败时 tail -15 输出。

**C. Schema 同步证据**
若 `schema.prisma` staged：
1. 跑 `prisma generate`
2. 检查 `docs/database-schema.md` 是否一并 staged，且新模型有对应章节
3. 检查 `docs/schema-changelog.md` 是否一并 staged
4. 检查新增的 changelog 行里同时含 `staging:` 和 `prod:` 标记 —— 证明双库都推送过（防止 staging/prod 漂移）

### 3.3 `pre-schema-edit.sh` —— Prisma schema 修改门控

`Luddi/.claude/hooks/pre-schema-edit.sh`

仅在 `Edit` 或 `Write` 目标是 `schema.prisma` 时触发。区分四种情况：

| 操作 | 行为 |
|------|------|
| 删 model（old 有、new 没有） | **BLOCK**，要求确认（毁灭性） |
| 加新 model | **CONFIRM**（提示 generate + 文档同步） |
| 删字段（diff 出来 < 行） | **CONFIRM**（可能丢数据） |
| 普通字段改动（影响已有 model） | **CONFIRM**（提醒同步文档） |
| 全文 `Write` | **BLOCK**（拒绝整文件覆盖） |

实现细节：用 Python 提取 `tool_input.old_string` / `new_string`，正则 `^model ` 拿 model 名，`diff` 拿字段差。

### 3.4 `post-schema-edit.sh` —— 改完 schema 后提示

PostToolUse 阶段，只在 `Edit/Write` 目标是 `schema.prisma` 时打印 next-step 模板：跑 `prisma generate`、双库 push、更新 doc + changelog。

### 3.5 `stop-check-tests.sh` —— 收尾时强制测试覆盖

`Luddi/.claude/hooks/stop-check-tests.sh`

Stop 事件触发，扫 staged 文件：

| Source 路径 | 期望测试位置 |
|-------------|--------------|
| `packages/api-core/src/services/*.ts` | 同目录 `*.test.ts` |
| `apps/api/src/routes/*.ts` | 同目录 `*.test.ts` |
| `apps/web/src/lib/*.ts` | 同目录 `*.test.ts` |
| `apps/mobile/lib/*.ts` | `apps/mobile/lib/__tests__/*.test.ts` |
| `apps/mobile/contexts/*.tsx` | `apps/mobile/__tests__/contexts/*.test.tsx` |

**INFRA_EXCLUDE** 正则跳过 SDK wrapper（auth/stripe/paypal/gcs/email/posthog/analytics/ai-providers）—— 这些难做有意义的 unit test。

任意 source 文件缺测试 → Exit 2，回送 missing 列表，Claude 被推回去补测试。

### 3.6 `on-compact.sh` —— 压缩后状态回灌

`Luddi/.claude/hooks/on-compact.sh`

`SessionStart` + `compact` matcher，打印：
- 最近 5 条 commit
- 暂存/未暂存文件数
- 端口 3000/3001/8081/8787 上是否有僵尸进程

让模型在被压缩后 5 秒内重建工作上下文。

### 3.7 `worktree-symlink.sh` —— worktree node_modules 软链

PreToolUse 阶段，触发条件不在文件正文里展示但目的明确：在 `.claude/worktrees/<branch>/` 启动时把主仓库的 `node_modules` symlink 进来，避免重复 `pnpm install`（Luddi 明令禁止 worktree 内跑 install / dev）。

## 4. Rules —— 上下文注入

`.claude/rules/*.md` 顶部用 `# Glob: ...` 声明匹配文件。当 Claude 读相关文件时，对应规则被注入到上下文。

### 4.1 `schema.md`

`Luddi/.claude/rules/schema.md`

Glob: `**/schema.prisma, **/database-schema.md, **/schema-changelog.md`

强调三件事：destructive 要确认；改完要 generate + 双库 push（`pnpm --filter @luddi/db db:push:both`）；commit 时 changelog 必须含 staging + prod 双标记。

### 4.2 `session-safety.md`

`Luddi/.claude/rules/session-safety.md`

Glob: `**/*`（永远注入）

- 端口 3000/3001/8081/8787 自动清理
- 长任务 wrap `timeout`
- Max 5 并发子 agent
- worktree 禁 `pnpm install` / `pnpm dev`
- 重活不并行（install / build / tsc）

**核心警告**：hook 字面量匹配陷阱。检查进程时用 `lsof -ti:3000` 而非 `pgrep -fl "next dev"`。

### 4.3 `testing.md`

`Luddi/.claude/rules/testing.md`

Glob: `**/*.test.ts, **/*.test.tsx`

声明各包的测试框架（Vitest vs Jest）、DB auto-mock 位置、Mobile vs Backend 的 API 差异（`vi.fn()` vs `jest.fn()`）、Hono 路由测试模式。

## 5. Agents —— 独立子 agent

每个 agent 是一个 markdown 文件，frontmatter 声明工具/模型/记忆，body 是系统提示词。

### 5.1 `reviewer.md`

`Luddi/.claude/agents/reviewer.md`

```yaml
model: sonnet
maxTurns: 10
tools: Read, Grep, Glob, Bash, Write, Edit
memory: project
```

- "你没写这段代码 —— 用新眼睛 review"
- 检查清单：correctness / security / edge cases / test coverage / API contract / 信用积分（300/50/200）
- 输出格式固定：Issues / Suggestions / Verdict (PASS|NEEDS_FIX)
- **不允许**编辑项目文件，只报告
- **允许**写 `.claude/agent-memory/reviewer/` 记录学习

**自演化机制**：发现 2+ 次的 anti-pattern → 写入 MEMORY.md + 主题文件 + 在文末 `## Learnings` 加一行（直接进系统提示词，下次启动就 know）。

### 5.2 `tester.md`

`Luddi/.claude/agents/tester.md`

```yaml
model: sonnet
maxTurns: 15
memory: project
```

包含：测试约定表（哪个包用哪个框架）、DB auto-mock 模式、Mobile/Backend 差异、典型 mock 模式 (`(db.game.findUnique as any).mockResolvedValue({...})`)、Workflow 6 步、自演化机制。

### 5.3 `agent-memory/` —— 持久记忆

`.claude/agent-memory/<agent-name>/` 下：
- `MEMORY.md` —— 索引文件，每行一个主题文件链接
- `<topic>.md` —— 具体学习，如 `mock-patterns.md`、`anti-patterns.md`

agent 启动时**先读自己的 memory**，避免重复解决已解决的问题。

## 6. Commands —— 用户可调 slash command

`.claude/commands/<name>.md`，用户输入 `/<name> <args>` 触发。frontmatter：

```yaml
name: implement
description: ...
argument-hint: <task description>
allowed-tools:
  - Read
  - Bash
  - Skill
  - AskUserQuestion
```

Body 是给 Claude 的 prompt：分 Phase A/B/C/D 走流程。**核心模式：command 只做 pre-flight + 委托 skill，skill 干活，结果回灌**。

### 6.1 `implement.md`

`Luddi/.claude/commands/implement.md`

- Phase A：git status / branch / log 并行查；脏树 + master 用 `AskUserQuestion` 让用户选 stash / abort
- Phase B：echo 任务
- Phase C：Skill tool 调 `implement`
- Phase D：post-flight 报告

### 6.2 `verify.md`

`Luddi/.claude/commands/verify.md`

- Phase A：从 `git diff --name-only HEAD` 推断要跑哪些包（同 pre-commit-gate 的级联表）
- Phase B：调 `verify` skill，传包名列表 + `fix` flag
- Phase C：转述结果

### 6.3 `review.md`

`Luddi/.claude/commands/review.md`

- Phase A：解析参数 —— 文件路径 / PR 号 / 空 → 推断 review target
- Phase B：调 `review` skill
- Phase C：relay verdict，NEEDS_FIX 时主动问"要现在 fix 吗？"

### 6.4 `release-mobile.md`

Mobile EAS 发版的多步流程编排。adex 没 mobile 端，未移植。

## 7. Skills —— 可复用执行单元

`.claude/skills/<name>/SKILL.md`。frontmatter 关键字段：

```yaml
user-invocable: false   # 只能被 command 调，用户不能直接 /<skill>
allowed-tools: ...      # 比 command 更宽，能 Edit/Write/Agent
```

skill 是真正干活的地方。

### 7.1 `implement/SKILL.md`

`Luddi/.claude/skills/implement/SKILL.md`

四阶段：
1. **Plan** — 读源码、TaskCreate 拆任务
2. **Implement** — 每个子任务：写代码 + 写测试 + 跑测试 + 失败修 + mark completed
3. **Verify** — 全量跑测试 → spawn `reviewer` agent → 处理 NEEDS_FIX → `git add`
4. **Report** — 改动汇总 + verdict

### 7.2 `verify/SKILL.md`

`Luddi/.claude/skills/verify/SKILL.md`

输入 `packages` 列表 + `fix` flag。串行（**禁止并行**，内存压力）跑 `pnpm --filter <pkg> run test`，结构化报告，`fix` 模式只修一遍不循环。

### 7.3 `review/SKILL.md`

`Luddi/.claude/skills/review/SKILL.md`

只做 orchestrator —— 把 target 传给 `reviewer` agent，捕获 Issues/Suggestions/Verdict 原样返回。**永不自己 review**（保独立性）。

## 8. CLAUDE.md —— 项目级上下文文件

`Luddi/CLAUDE.md`（17KB）

不在 `.claude/` 目录下，但是整个体系的入口。结构：

1. **顶部 `@docs/...` 引用** —— 用 `@` 前缀标记自动注入到上下文的子文档（ops manual、design 规范）；其他用文字标"按需读"
2. **Project Overview** —— 一句话定位
3. **Monorepo Layout** —— 包结构 + 包管理器
4. **Key Technologies** —— 框架版本 + 关键事实（如"NextAuth v5 真实配置在 apps/api/src/auth-config.ts，不在 web"）
5. **API Architecture** —— 数据流图 + 各层职责 + 文件位置
6. **Critical Rules** —— **每条规则后括号注明 enforced by hook 名字**，明确"不是 Claude 自律，是 harness 强制"
7. **Important Conventions** —— Next.js 16 breaking changes、auth、积分系统、game runtime、GCS、admin console
8. **Common Commands** —— 复制即用的 bash
9. **File Locations** —— 表格速查
10. **Environment Variables** —— 列关键的，全量给 doc 链接
11. **Deployment** —— GCP setup
12. **Debugging Production** —— Sentry vs Cloud Logging 的选用决策
13. **Known Issues** —— 已知坑点列表（cookie bloat、PayPal idempotency、ai-providers legacy fields...）
14. **Session Safety** —— 指向 `.claude/rules/session-safety.md`

**Why it works**: 把"读 CLAUDE.md"做成 Claude 的第一动作，把规则和强制者绑定（"这条不是建议，是 hook 拦着的"），把决策表（"调试 prod 走哪条链路"）做出来。

## 9. 给 adex 的迁移决策

| Luddi 原件 | adex 处理 | 原因 |
|------------|-----------|------|
| `pre-bash.sh` 多端口 kill | 单端口 3000 | adex 单 Next.js 应用 |
| `pre-bash.sh` block docker-compose | 收紧到只 block postgres/pg/db 关键字 | adex 没禁掉所有 compose |
| `pre-commit-gate.sh` 包级联测试 | 改成 lint + tsc + 检查 schema 迁移 | adex 没 monorepo / Vitest |
| commit format scope 列表 | 替换为 adex 的：app/api/db/ui/auth/platform/advisor/cron/deploy/migration | Luddi 的 web/mobile 等不适用 |
| `Phase N: ...` 兼容 | 新增 | adex 历史 commit 用过这个格式 |
| `pre-schema-edit.sh` 双库 push 规则 | 替换为 prisma migrate dev + 检查 migration 目录 staged | adex 用 prisma migrate（迁移文件），不像 Luddi 用 db push |
| `stop-check-tests.sh` 强制测试 | 改成软提醒（warn not block） | adex 没 unit-test 框架 |
| `worktree-symlink.sh` | 未移植 | adex 用 npm，没 pnpm workspace symlink 痛点 |
| `release-mobile` command + skill | 未移植 | adex 没 mobile |
| `agents/reviewer + tester` | 移植，调整上下文片段 | 通用，按 adex 的栈和 anti-patterns 重写 |
| `skills/implement, verify, review` | 移植，重写命令 | 把 pnpm filter 换成 npm + 单仓 |
| `rules/schema, session-safety, testing` | 移植，全部按 adex 改写 | 同上 |
| `agent-memory/{reviewer,tester}/MEMORY.md` | 移植，留空索引 | 上线后由 agent 自己填充 |

## 10. 维护建议

- **Luddi 演进时回看这里**：Luddi 的 hook / skill 改动如果是结构性的（不是项目特异），考虑同步到 adex
- **adex 加新工程化规则时**：先在 `AGENTS.md` 写"Critical Rules"条目并标"enforced by hook X"，再写或改 `.claude/hooks/X.sh`，最后更新本文档第 9 节的迁移表
- **agent learnings 别失控**：`Learnings` section 一行一条，超过 5 条就拆到主题文件并在 MEMORY.md 索引

## 11. 关键文件清单（adex 版本）

实际落地到 adex 的文件：

- [adex/AGENTS.md](../../AGENTS.md) — 项目级上下文
- [adex/CLAUDE.md](../../CLAUDE.md) — `@AGENTS.md` 一行入口
- [adex/.claude/settings.json](../../.claude/settings.json)
- [adex/.claude/hooks/pre-bash.sh](../../.claude/hooks/pre-bash.sh)
- [adex/.claude/hooks/pre-commit-gate.sh](../../.claude/hooks/pre-commit-gate.sh)
- [adex/.claude/hooks/pre-schema-edit.sh](../../.claude/hooks/pre-schema-edit.sh)
- [adex/.claude/hooks/post-schema-edit.sh](../../.claude/hooks/post-schema-edit.sh)
- [adex/.claude/hooks/stop-check-tests.sh](../../.claude/hooks/stop-check-tests.sh)
- [adex/.claude/hooks/on-compact.sh](../../.claude/hooks/on-compact.sh)
- [adex/.claude/agents/reviewer.md](../../.claude/agents/reviewer.md)
- [adex/.claude/agents/tester.md](../../.claude/agents/tester.md)
- [adex/.claude/commands/implement.md](../../.claude/commands/implement.md)
- [adex/.claude/commands/verify.md](../../.claude/commands/verify.md)
- [adex/.claude/commands/review.md](../../.claude/commands/review.md)
- [adex/.claude/skills/implement/SKILL.md](../../.claude/skills/implement/SKILL.md)
- [adex/.claude/skills/verify/SKILL.md](../../.claude/skills/verify/SKILL.md)
- [adex/.claude/skills/review/SKILL.md](../../.claude/skills/review/SKILL.md)
- [adex/.claude/rules/schema.md](../../.claude/rules/schema.md)
- [adex/.claude/rules/session-safety.md](../../.claude/rules/session-safety.md)
- [adex/.claude/rules/testing.md](../../.claude/rules/testing.md)
- [adex/.claude/agent-memory/reviewer/MEMORY.md](../../.claude/agent-memory/reviewer/MEMORY.md)
- [adex/.claude/agent-memory/tester/MEMORY.md](../../.claude/agent-memory/tester/MEMORY.md)

用户级 auto-memory（不在 repo，存在每个用户的本机 home 下）：

- `~/.claude/projects/<project-slug>/memory/MEMORY.md`（索引）
- `~/.claude/projects/<project-slug>/memory/project_adex_overview.md`
- `~/.claude/projects/<project-slug>/memory/project_auth_custom_cookies.md`
- `~/.claude/projects/<project-slug>/memory/project_testing_status.md`
- `~/.claude/projects/<project-slug>/memory/reference_luddi_pattern.md`

> `<project-slug>` 由 Claude Code 自动生成（项目绝对路径以 `-` 替代 `/` 的 slug 化形式）。每位贡献者本机的 slug 不同，所以这层记忆是**个人化**的，不入 git，团队共享的知识应该写到 `.claude/agent-memory/` 里。
