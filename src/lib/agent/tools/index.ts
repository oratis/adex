import type { ToolDefinition } from '../types'
import { pauseCampaignTool } from './pause-campaign'
import { resumeCampaignTool } from './resume-campaign'
import { adjustDailyBudgetTool } from './adjust-daily-budget'
import { pauseAdGroupTool } from './pause-ad-group'
import { pauseAdTool } from './pause-ad'
import { rotateCreativeTool } from './rotate-creative'
import { flagForReviewTool } from './flag-for-review'
import { noopTool } from './noop'
import { cloneCampaignTool } from './clone-campaign'
import { startExperimentTool } from './start-experiment'
import { concludeExperimentTool } from './conclude-experiment'
import { adjustBidTool } from './adjust-bid'
import { enableSmartBiddingTool } from './enable-smart-bidding'
import { adjustTargetingGeoTool } from './adjust-targeting-geo'
import { adjustTargetingDemoTool } from './adjust-targeting-demo'
import { pushCreativeToPlatformTool } from './push-creative-to-platform'
import { generateCreativeVariantTool } from './generate-creative-variant'

export const TOOLS: Record<string, ToolDefinition<unknown>> = {
  // Phase 13 — low/medium risk
  pause_campaign: pauseCampaignTool as ToolDefinition<unknown>,
  resume_campaign: resumeCampaignTool as ToolDefinition<unknown>,
  adjust_daily_budget: adjustDailyBudgetTool as ToolDefinition<unknown>,
  pause_ad_group: pauseAdGroupTool as ToolDefinition<unknown>,
  pause_ad: pauseAdTool as ToolDefinition<unknown>,
  rotate_creative: rotateCreativeTool as ToolDefinition<unknown>,
  flag_for_review: flagForReviewTool as ToolDefinition<unknown>,
  noop: noopTool as ToolDefinition<unknown>,
  // Phase 15 — creative + experimentation
  clone_campaign: cloneCampaignTool as ToolDefinition<unknown>,
  start_experiment: startExperimentTool as ToolDefinition<unknown>,
  conclude_experiment: concludeExperimentTool as ToolDefinition<unknown>,
  generate_creative_variant: generateCreativeVariantTool as ToolDefinition<unknown>,
  push_creative_to_platform: pushCreativeToPlatformTool as ToolDefinition<unknown>,
  // Phase 16 — high risk (autonomous mode + tight guardrails only)
  adjust_bid: adjustBidTool as ToolDefinition<unknown>,
  enable_smart_bidding: enableSmartBiddingTool as ToolDefinition<unknown>,
  adjust_targeting_geo: adjustTargetingGeoTool as ToolDefinition<unknown>,
  adjust_targeting_demo: adjustTargetingDemoTool as ToolDefinition<unknown>,
}

export function getTool(name: string): ToolDefinition<unknown> | undefined {
  return TOOLS[name]
}

export function listTools(): ToolDefinition<unknown>[] {
  return Object.values(TOOLS)
}

export function toolCatalogForPrompt() {
  return Object.values(TOOLS).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    riskLevel: t.riskLevel,
    reversible: t.reversible,
  }))
}
