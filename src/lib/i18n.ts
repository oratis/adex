/**
 * Lightweight dictionary-based i18n.
 *
 * Deliberately minimal — one module, no dependencies, supports 'en' + 'zh'.
 * Used by <I18nProvider> and the useT() hook. Keys missing in the active
 * locale fall back to English.
 *
 * Convention: keep all keys here so adding a new translation is one PR
 * instead of touching N component files. If you add a key, add it to BOTH
 * dicts in the same commit; missing zh values silently fall back to en.
 */

export type Locale = 'en' | 'zh'

export const LOCALES: Locale[] = ['en', 'zh']

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
}

type Dict = Record<string, string>

const en: Dict = {
  // ===== Navigation =====
  'nav.dashboard': 'Dashboard',
  'nav.campaigns': 'Campaigns',
  'nav.seedance2': 'Seedance2',
  'nav.assets': 'Asset Library',
  'nav.creatives': 'Creatives',
  'nav.budget': 'Budget',
  'nav.advisor': 'AI Advisor',
  'nav.settings': 'Settings',
  'nav.signed_in_as': 'Signed in as',
  'nav.light_mode': 'Light mode',
  'nav.dark_mode': 'Dark mode',
  'nav.logout': 'Logout',
  'nav.logging_out': 'Signing out…',
  'nav.decisions': 'Decisions',
  'nav.approvals': 'Approvals',
  'nav.guardrails': 'Guardrails',
  'nav.experiments': 'Experiments',
  'nav.prompts': 'Prompts',
  'nav.agent_cost': 'LLM cost',
  'nav.agent_stats': 'Agent stats',
  'nav.agent_onboarding': 'Onboarding',
  'nav.webhooks': 'Webhooks',
  'nav.creative_review': 'Creative review',
  'nav.orphans': 'Orphan campaigns',
  'nav.audit': 'Audit log',
  'nav.admin.section': 'Platform admin',
  'nav.admin.invites': 'Invite codes',
  'nav.admin.users': 'Users',

  // ===== Common actions =====
  'action.save': 'Save',
  'action.saving': 'Saving...',
  'action.cancel': 'Cancel',
  'action.delete': 'Delete',
  'action.edit': 'Edit',
  'action.refresh': 'Refresh',
  'action.sync': 'Sync Data',
  'action.syncing': 'Syncing...',
  'action.pause': 'Pause',
  'action.resume': 'Resume',
  'action.archive': 'Archive',
  'action.launch': 'Launch',
  'action.upload': 'Upload',
  'action.uploading': 'Uploading...',
  'action.create': 'Create',
  'action.creating': 'Creating…',
  'action.approve': 'Approve',
  'action.reject': 'Reject',
  'action.run_now': 'Run now',
  'action.snapshot_now': 'Snapshot now',
  'action.rollback': 'Roll back',
  'action.confirm': 'Confirm',
  'action.copy_link': 'Copy link',
  'action.revoke': 'Revoke',
  'action.import': 'Import',
  'action.ignore': 'Ignore',
  'action.requeue': 'Requeue now',
  'action.promote': 'Promote',
  'action.demote': 'Demote',
  'action.disable': 'Disable',
  'action.enable': 'Enable',
  'action.bulk_approve': 'Approve selected',
  'action.bulk_reject': 'Reject selected',
  'action.bulk_pause': 'Pause selected',
  'action.bulk_resume': 'Resume selected',
  'action.bulk_archive': 'Archive selected',
  'action.bulk_rollback': 'Roll back selected',
  'action.clear': 'Clear',
  'action.select_all': 'Select all',
  'action.open_page': 'Open page →',

  // ===== Page titles & subtitles =====
  'page.dashboard.title': 'Dashboard',
  'page.dashboard.subtitle': 'Overview of your ad performance across all platforms',
  'page.campaigns.title': 'Campaigns',
  'page.campaigns.subtitle': 'Manage your ad campaigns across all platforms',
  'page.budget.title': 'Budget',
  'page.budget.subtitle': 'Manage advertising budgets across campaigns',
  'page.creatives.title': 'Creatives',
  'page.creatives.subtitle': 'Manage ad creatives - upload or generate with AI',
  'page.assets.title': 'Asset Library',
  'page.assets.subtitle': 'Shared creative assets — all users can contribute and browse',
  'page.advisor.title': 'AI Advisor',
  'page.settings.title': 'Settings',
  'page.settings.subtitle': 'Configure platform authorizations and account settings',
  'page.decisions.title': 'Agent Decisions',
  'page.decisions.subtitle':
    'Records of every plan-then-act cycle. Shadow = LLM proposes, nothing runs. Approval = decisions wait for a human in /approvals. Autonomous = guardrails enforce.',
  'page.approvals.title': 'Pending approvals',
  'page.approvals.subtitle':
    "Decisions the agent wants to take but that need a human green light. Approving runs the tools immediately. Rejecting closes the decision with no platform-side change.",
  'page.guardrails.title': 'Guardrails',
  'page.guardrails.subtitle':
    'Hard rules the agent cannot violate. The 12 built-in evaluators run on every step; org-level rules below extend or tighten them.',
  'page.experiments.title': 'A/B experiments',
  'page.experiments.subtitle':
    'Two-arm tests against a campaign. Conclude runs a two-proportion z-test on the primary metric (ctr or cvr) and stores the winning arm + p-value on the experiment record.',
  'page.prompts.title': 'Prompt versions',
  'page.prompts.subtitle':
    'DB-backed prompt registry. Mark a version as default to make the agent loop pick it up on the next cron tick. Backtest a candidate against the last 7d of perceive snapshots before promoting.',
  'page.agent_cost.title': 'Agent LLM cost',
  'page.agent_cost.subtitle':
    'Per-org breakdown of plan() calls and downstream PromptRun costs. Hard cap is enforced by the llm_budget_cap guardrail.',
  'page.agent_stats.title': 'Agent stats',
  'page.agent_stats.subtitle':
    'Aggregated activity for this org. Drives the weekly digest and gives a quick read on whether the agent is healthy enough to upgrade modes.',
  'page.agent_onboarding.title': 'Agent onboarding',
  'page.agent_onboarding.subtitle':
    'New orgs progress through three stages. Each upgrade enforces a minimum dwell time server-side; you can downgrade at any moment.',
  'page.webhooks.title': 'Webhook deliveries',
  'page.webhooks.subtitle':
    'Failed deliveries are retried with exponential backoff (60s → 12h, capped at 5 attempts). Abandoned rows can be force-requeued from here.',
  'page.creative_review.title': 'Creative review',
  'page.creative_review.subtitle':
    "Agent-generated creatives sit here in pending until an admin approves or rejects. Only approved creatives can be pushed to a platform via push_creative_to_platform.",
  'page.orphans.title': 'Orphan campaigns',
  'page.orphans.subtitle':
    "Campaigns discovered on a platform that have no local Campaign row. Import to start managing them in Adex; ignore to mark permanently out-of-scope.",
  'page.audit.title': 'Audit log',
  'page.audit.subtitle':
    'Append-only record of every consequential action in this org. Useful for incident forensics and compliance review. Most recent 200 events shown.',
  'page.admin.invites.title': 'Invite codes',
  'page.admin.invites.subtitle':
    "Adex is invite-only. Generate codes here and share them with new users. Each code is single-use; once redeemed, it can't be used again. Revoke any code at any time — unused holders are immediately blocked.",
  'page.admin.users.title': 'Users',
  'page.admin.users.subtitle':
    'Every registered user. Promote to platform admin to grant invite-code minting + admin-page access.',
  'page.setup.title': 'Welcome',
  'page.setup.subtitle': '4-step setup',

  // ===== Dashboard stats =====
  'stats.total_spend': 'Total Spend',
  'stats.revenue': 'Revenue',
  'stats.impressions': 'Impressions',
  'stats.conversions': 'Conversions',
  'stats.clicks': 'Clicks',
  'stats.total_budget': 'Total Budget',
  'stats.total_spent': 'Total Spent',
  'stats.remaining': 'Remaining',
  'stats.utilization': 'Utilization',

  // ===== Auth =====
  'auth.sign_in': 'Sign In',
  'auth.signing_in': 'Signing in...',
  'auth.create_account': 'Create Account',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.name': 'Name',
  'auth.forgot': 'Forgot?',
  'auth.register': 'Register',
  'auth.already_have': 'Already have an account?',
  'auth.dont_have': "Don't have an account?",
  'auth.reset_password': 'Reset password',
  'auth.new_password': 'New password',
  'auth.confirm_password': 'Confirm password',
  'auth.invite_code': 'Invite code',
  'auth.invite_code_required': 'Invite code is required',
  'auth.invite_only_notice':
    'Adex is invite-only. Ask a platform admin for a code (format INVT-XXXX-XXXX-XXXX).',

  // ===== Campaigns =====
  'campaign.new': '+ New Campaign',
  'campaign.empty': 'No campaigns yet. Create your first campaign to start advertising.',
  'campaign.launch_confirm': 'Launch this campaign to the ad platform?',

  // ===== Advisor =====
  'advisor.refresh': 'Refresh Advice',
  'advisor.refreshing': 'Refreshing…',
  'advisor.recommendations': 'Recommendations',
  'advisor.pause_campaign': '⏸ Pause Campaign',
  'advisor.resume_campaign': '▶ Resume Campaign',
  'advisor.applying': 'Applying…',

  // ===== Settings tabs =====
  'settings.tab.platforms': 'Platform Auth',
  'settings.tab.profile': 'Profile & Notifications',
  'settings.tab.members': 'Team',
  'settings.tab.account': 'Account',

  // ===== Team =====
  'team.members': 'Members',
  'team.invite_heading': 'Invite a teammate',
  'team.send_invite': 'Send Invite',
  'team.sending': 'Sending…',
  'team.create_workspace': 'Create a new workspace',
  'team.pending_invites': 'Pending invites',
  'team.revoke': 'Revoke',
  'team.role.owner': 'Owner',
  'team.role.admin': 'Admin',
  'team.role.member': 'Member',

  // ===== Workspace switcher =====
  'workspace.label': 'Workspace',
  'workspace.manage_members': 'Manage members',
  'workspace.create_new': '+ Create workspace',

  // ===== Agent — modes & status =====
  'agent.mode.shadow': 'Shadow',
  'agent.mode.approval_only': 'Approval only',
  'agent.mode.autonomous': 'Autonomous',
  'agent.kill_switch': 'Kill switch',
  'agent.enable': 'Enable agent',
  'agent.disable': 'Disable agent',
  'agent.severity.info': 'Info',
  'agent.severity.opportunity': 'Opportunity',
  'agent.severity.warning': 'Warning',
  'agent.severity.alert': 'Alert',
  'agent.outcome.success': 'Worked',
  'agent.outcome.neutral': 'Neutral',
  'agent.outcome.regression': 'Backfired',
  'agent.outcome.false_positive': 'False alarm',

  // ===== Common UI strings =====
  'ui.loading': 'Loading…',
  'ui.empty': 'Nothing here yet',
  'ui.error': 'Something went wrong',
  'ui.confirm_delete': 'Delete this item? This cannot be undone.',
  'ui.skip_to_dashboard': 'Skip setup and go to dashboard →',
  'ui.copied': 'Copied to clipboard',
  'ui.notifications.title': 'Notifications',
  'ui.notifications.all_clear': 'All clear ✨',
  'ui.cmdk.placeholder': 'Type to search…',
  'ui.cmdk.no_matches': 'No matches',
  'ui.filter': 'Filter',

  // ===== Filters =====
  'filter.all_status': 'all status',
  'filter.all_severity': 'all severity',
  'filter.since': 'since',
  'filter.until': 'until',
  'filter.campaignId': 'campaignId',
  'filter.action': 'action',
  'filter.target': 'target',

  // ===== Notifications panel =====
  'notif.pending_approvals': 'Pending approvals',
  'notif.expiring': 'expiring < 12h',
  'notif.drifted_campaigns': 'Drifted campaigns',
  'notif.creatives_pending': 'Creatives awaiting review',
  'notif.abandoned_deliveries': 'Abandoned webhook deliveries',
  'notif.failed_decisions': 'Failed agent decisions',
  'notif.unused_invites': 'Unused invite codes',
}

const zh: Dict = {
  // ===== 导航 =====
  'nav.dashboard': '仪表盘',
  'nav.campaigns': '广告系列',
  'nav.seedance2': 'Seedance2 视频',
  'nav.assets': '素材库',
  'nav.creatives': '创意',
  'nav.budget': '预算',
  'nav.advisor': 'AI 顾问',
  'nav.settings': '设置',
  'nav.signed_in_as': '当前登录',
  'nav.light_mode': '浅色模式',
  'nav.dark_mode': '深色模式',
  'nav.logout': '退出登录',
  'nav.logging_out': '正在退出…',
  'nav.decisions': 'Agent 决策',
  'nav.approvals': '待审批',
  'nav.guardrails': '安全规则',
  'nav.experiments': 'A/B 实验',
  'nav.prompts': 'Prompt 版本',
  'nav.agent_cost': 'LLM 成本',
  'nav.agent_stats': 'Agent 统计',
  'nav.agent_onboarding': 'Agent 上手',
  'nav.webhooks': '回调投递',
  'nav.creative_review': '创意审核',
  'nav.orphans': '孤儿广告系列',
  'nav.audit': '审计日志',
  'nav.admin.section': '平台管理员',
  'nav.admin.invites': '邀请码',
  'nav.admin.users': '用户',

  // ===== 通用动作 =====
  'action.save': '保存',
  'action.saving': '保存中...',
  'action.cancel': '取消',
  'action.delete': '删除',
  'action.edit': '编辑',
  'action.refresh': '刷新',
  'action.sync': '同步数据',
  'action.syncing': '同步中...',
  'action.pause': '暂停',
  'action.resume': '恢复',
  'action.archive': '归档',
  'action.launch': '启动',
  'action.upload': '上传',
  'action.uploading': '上传中...',
  'action.create': '创建',
  'action.creating': '创建中…',
  'action.approve': '批准',
  'action.reject': '拒绝',
  'action.run_now': '立即运行',
  'action.snapshot_now': '立即快照',
  'action.rollback': '回滚',
  'action.confirm': '确认',
  'action.copy_link': '复制链接',
  'action.revoke': '撤销',
  'action.import': '导入',
  'action.ignore': '忽略',
  'action.requeue': '重新排队',
  'action.promote': '提升',
  'action.demote': '降级',
  'action.disable': '停用',
  'action.enable': '启用',
  'action.bulk_approve': '批量批准',
  'action.bulk_reject': '批量拒绝',
  'action.bulk_pause': '批量暂停',
  'action.bulk_resume': '批量恢复',
  'action.bulk_archive': '批量归档',
  'action.bulk_rollback': '批量回滚',
  'action.clear': '清空',
  'action.select_all': '全选',
  'action.open_page': '打开页面 →',

  // ===== 页面标题 =====
  'page.dashboard.title': '仪表盘',
  'page.dashboard.subtitle': '跨平台广告表现总览',
  'page.campaigns.title': '广告系列',
  'page.campaigns.subtitle': '管理所有平台的广告系列',
  'page.budget.title': '预算',
  'page.budget.subtitle': '管理各广告系列的预算分配',
  'page.creatives.title': '创意素材',
  'page.creatives.subtitle': '管理广告创意 - 手动上传或 AI 生成',
  'page.assets.title': '素材库',
  'page.assets.subtitle': '共享素材库 - 所有用户可贡献和浏览',
  'page.advisor.title': 'AI 顾问',
  'page.settings.title': '设置',
  'page.settings.subtitle': '配置平台授权和账号设置',
  'page.decisions.title': 'Agent 决策',
  'page.decisions.subtitle':
    'Agent 每次「分析 → 行动」循环的记录。Shadow = LLM 只提议，不执行。Approval = 决策进 /approvals 等待人工。Autonomous = guardrail 自动放行。',
  'page.approvals.title': '待审批',
  'page.approvals.subtitle':
    'Agent 想做但需要人工放行的决策。批准后立即执行；拒绝后关闭，不影响平台。',
  'page.guardrails.title': '安全规则',
  'page.guardrails.subtitle':
    '硬性规则，Agent 不能越线。12 条内建规则始终生效；下方可加自定义规则覆盖默认值或加新约束。',
  'page.experiments.title': 'A/B 实验',
  'page.experiments.subtitle':
    '基于 campaign 的双臂测试。结束时跑两比例 z-test，结果按主要指标（ctr 或 cvr）写到 experiment 记录上。',
  'page.prompts.title': 'Prompt 版本',
  'page.prompts.subtitle':
    'DB 持久化的 prompt 注册表。把某版本设为 default，下次 cron 触发即生效。推全前可以用 backtest 拿过去 7 天的 perceive 数据回放对比。',
  'page.agent_cost.title': 'Agent LLM 成本',
  'page.agent_cost.subtitle':
    '本组织的 plan() 调用和下游 PromptRun 成本细分。硬上限由 llm_budget_cap 规则强制。',
  'page.agent_stats.title': 'Agent 统计',
  'page.agent_stats.subtitle':
    '本组织的 Agent 活动聚合。驱动周报，方便快速判断当前模式是否健康。',
  'page.agent_onboarding.title': 'Agent 上手',
  'page.agent_onboarding.subtitle':
    '新组织按三阶段升级。每次升级有最小停留时间硬性校验，但任何时候都可以降级。',
  'page.webhooks.title': '回调投递',
  'page.webhooks.subtitle':
    '失败的投递走指数退避重试（60s → 12h，最多 5 次）。已放弃的可以从这里手动重排队。',
  'page.creative_review.title': '创意审核',
  'page.creative_review.subtitle':
    'Agent 生成的创意都先进 pending，admin 批准/拒绝。只有 approved 才能通过 push_creative_to_platform 推到平台。',
  'page.orphans.title': '孤儿广告系列',
  'page.orphans.subtitle':
    '在平台侧发现但 Adex 本地没有对应记录的广告系列。Import 后开始统一管理；Ignore 永久忽略。',
  'page.audit.title': '审计日志',
  'page.audit.subtitle':
    '本组织所有重要动作的只追加记录。事故复盘 / 合规审查的依据。最近 200 条。',
  'page.admin.invites.title': '邀请码',
  'page.admin.invites.subtitle':
    'Adex 是邀请制。在这里生成码并分发给新用户。每码单次使用，用过即失效。可随时撤销，未使用的持有者立即被拦。',
  'page.admin.users.title': '用户',
  'page.admin.users.subtitle': '所有注册用户。提升为平台管理员可以发邀请码 + 访问管理页面。',
  'page.setup.title': '欢迎',
  'page.setup.subtitle': '4 步上手指南',

  // ===== 仪表盘指标 =====
  'stats.total_spend': '总支出',
  'stats.revenue': '收入',
  'stats.impressions': '曝光',
  'stats.conversions': '转化',
  'stats.clicks': '点击',
  'stats.total_budget': '总预算',
  'stats.total_spent': '已支出',
  'stats.remaining': '剩余',
  'stats.utilization': '使用率',

  // ===== 鉴权 =====
  'auth.sign_in': '登录',
  'auth.signing_in': '登录中...',
  'auth.create_account': '注册',
  'auth.email': '邮箱',
  'auth.password': '密码',
  'auth.name': '姓名',
  'auth.forgot': '忘记密码?',
  'auth.register': '注册',
  'auth.already_have': '已有账号?',
  'auth.dont_have': '还没有账号?',
  'auth.reset_password': '重置密码',
  'auth.new_password': '新密码',
  'auth.confirm_password': '确认密码',
  'auth.invite_code': '邀请码',
  'auth.invite_code_required': '邀请码是必填的',
  'auth.invite_only_notice':
    'Adex 是邀请制。请向平台管理员索取邀请码（格式 INVT-XXXX-XXXX-XXXX）。',

  // ===== 广告系列 =====
  'campaign.new': '+ 新建广告系列',
  'campaign.empty': '还没有广告系列，创建第一个开始投放吧。',
  'campaign.launch_confirm': '将该广告系列发布到广告平台？',

  // ===== Advisor =====
  'advisor.refresh': '刷新建议',
  'advisor.refreshing': '刷新中…',
  'advisor.recommendations': '优化建议',
  'advisor.pause_campaign': '⏸ 暂停系列',
  'advisor.resume_campaign': '▶ 恢复系列',
  'advisor.applying': '执行中…',

  // ===== 设置 tab =====
  'settings.tab.platforms': '平台授权',
  'settings.tab.profile': '个人资料 & 通知',
  'settings.tab.members': '团队成员',
  'settings.tab.account': '账号',

  // ===== 团队 =====
  'team.members': '成员',
  'team.invite_heading': '邀请队友',
  'team.send_invite': '发送邀请',
  'team.sending': '发送中…',
  'team.create_workspace': '创建新工作区',
  'team.pending_invites': '待处理邀请',
  'team.revoke': '撤销',
  'team.role.owner': '所有者',
  'team.role.admin': '管理员',
  'team.role.member': '成员',

  // ===== 工作区切换 =====
  'workspace.label': '工作区',
  'workspace.manage_members': '管理成员',
  'workspace.create_new': '+ 创建工作区',

  // ===== Agent 模式 + 状态 =====
  'agent.mode.shadow': '观察模式',
  'agent.mode.approval_only': '审批模式',
  'agent.mode.autonomous': '自治模式',
  'agent.kill_switch': '紧急停机',
  'agent.enable': '启用 Agent',
  'agent.disable': '停用 Agent',
  'agent.severity.info': '提示',
  'agent.severity.opportunity': '机会',
  'agent.severity.warning': '警告',
  'agent.severity.alert': '紧急',
  'agent.outcome.success': '有效',
  'agent.outcome.neutral': '中性',
  'agent.outcome.regression': '反效果',
  'agent.outcome.false_positive': '误报',

  // ===== 通用 UI =====
  'ui.loading': '加载中…',
  'ui.empty': '这里还没有数据',
  'ui.error': '出错了',
  'ui.confirm_delete': '确认删除？此操作不可撤销。',
  'ui.skip_to_dashboard': '跳过引导，直接进仪表盘 →',
  'ui.copied': '已复制到剪贴板',
  'ui.notifications.title': '通知',
  'ui.notifications.all_clear': '全部处理完了 ✨',
  'ui.cmdk.placeholder': '输入搜索…',
  'ui.cmdk.no_matches': '没有匹配结果',
  'ui.filter': '筛选',

  // ===== 筛选 =====
  'filter.all_status': '全部状态',
  'filter.all_severity': '全部严重程度',
  'filter.since': '起始',
  'filter.until': '截止',
  'filter.campaignId': '广告系列 ID',
  'filter.action': '动作',
  'filter.target': '对象',

  // ===== 通知面板 =====
  'notif.pending_approvals': '待审批',
  'notif.expiring': '即将过期 < 12h',
  'notif.drifted_campaigns': '平台状态不一致',
  'notif.creatives_pending': '创意待审核',
  'notif.abandoned_deliveries': '回调投递失败',
  'notif.failed_decisions': '失败的 Agent 决策',
  'notif.unused_invites': '未使用的邀请码',
}

const DICT: Record<Locale, Dict> = { en, zh }

export function translate(locale: Locale, key: string): string {
  return DICT[locale]?.[key] ?? DICT.en[key] ?? key
}
