import Link from 'next/link'

/**
 * Small "?" icon next to a page title that links to the relevant section
 * of the user guide. Used so first-time users can self-serve when they hit
 * a confusing screen.
 *
 * Build the href with the docs section anchor — e.g.
 *   <HelpLink section="agent-shadow" />
 *   → /docs/user-guide#32-第一次开-agentshadow-模式
 *
 * docsSection is just a slug we map to the user-guide.md anchor.
 */

const SECTION_TO_ANCHOR: Record<string, string> = {
  'register': '12-注册账号',
  'platforms': '14-接广告平台',
  'first-campaign': '21-创建第一条-campaign',
  'creatives': '22-准备创意素材',
  'sync': '23-上线--观察数据',
  'advisor': '31-用-advisor-拿建议',
  'agent-shadow': '32-第一次开-agentshadow-模式',
  'decisions': '33-看-agent-给的决策',
  'approvals': '34-升级到审批模式',
  'guardrails': '35-配置安全规则',
  'autonomous': '36-升级到完全自动',
  'experiments': '41-ab-实验',
  'creative-ai': '42-ai-自动生成创意',
  'team': '43-多人协作',
  'slack': '44-接-slack-收通知',
  'troubleshoot': 'part-5--出问题怎么办',
}

export function HelpLink({ section, label }: { section: string; label?: string }) {
  const anchor = SECTION_TO_ANCHOR[section] || ''
  // Docs are markdown files, not in-app routes — so the link goes to GitHub
  // for the public repo. If a user has a copy of the repo cloned locally
  // they can override via NEXT_PUBLIC_DOCS_BASE_URL.
  const base =
    process.env.NEXT_PUBLIC_DOCS_BASE_URL ||
    'https://github.com/oratis/adex/blob/main/docs/user-guide.md'
  const href = anchor ? `${base}#${anchor}` : base
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-xs hover:bg-blue-100 hover:text-blue-600 transition-colors"
      title={label || `Open user guide · ${section}`}
      aria-label={label || 'Help'}
    >
      ?
    </Link>
  )
}
