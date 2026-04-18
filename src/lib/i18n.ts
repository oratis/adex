/**
 * Lightweight dictionary-based i18n.
 *
 * Deliberately minimal — one module, no dependencies, supports 'en' + 'zh'.
 * Used by <I18nProvider> and the useT() hook. Keys that are missing in the
 * active locale fall back to English.
 */

export type Locale = 'en' | 'zh'

export const LOCALES: Locale[] = ['en', 'zh']

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
}

type Dict = Record<string, string>

const en: Dict = {
  // Navigation
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

  // Common actions
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
  'action.launch': 'Launch',
  'action.upload': 'Upload',
  'action.uploading': 'Uploading...',

  // Page titles & subtitles
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

  // Dashboard stats
  'stats.total_spend': 'Total Spend',
  'stats.revenue': 'Revenue',
  'stats.impressions': 'Impressions',
  'stats.conversions': 'Conversions',
  'stats.clicks': 'Clicks',
  'stats.total_budget': 'Total Budget',
  'stats.total_spent': 'Total Spent',
  'stats.remaining': 'Remaining',
  'stats.utilization': 'Utilization',

  // Auth
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
}

const zh: Dict = {
  // Navigation
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

  // Common actions
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
  'action.launch': '启动',
  'action.upload': '上传',
  'action.uploading': '上传中...',

  // Page titles & subtitles
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

  // Dashboard stats
  'stats.total_spend': '总支出',
  'stats.revenue': '收入',
  'stats.impressions': '曝光',
  'stats.conversions': '转化',
  'stats.clicks': '点击',
  'stats.total_budget': '总预算',
  'stats.total_spent': '已支出',
  'stats.remaining': '剩余',
  'stats.utilization': '使用率',

  // Auth
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
}

const DICT: Record<Locale, Dict> = { en, zh }

export function translate(locale: Locale, key: string): string {
  return DICT[locale]?.[key] ?? DICT.en[key] ?? key
}
