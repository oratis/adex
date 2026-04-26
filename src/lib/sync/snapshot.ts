import { prisma } from '@/lib/prisma'
import type { PlatformAdapter, SyncedStatus } from '@/lib/platforms/adapter'
import { upsertPlatformLink } from '@/lib/platforms/links'

/**
 * captureCampaignSnapshots — fetch the platform's current campaign list and
 * persist one CampaignSnapshot row per campaign. Also upserts PlatformLink so
 * orphan campaigns (created in the platform UI) appear in our records.
 */
export async function captureCampaignSnapshots(opts: {
  adapter: PlatformAdapter
  orgId: string
}): Promise<{ snapshotsTaken: number; orphans: number }> {
  const list = await opts.adapter.fetchCampaignList()
  let orphans = 0
  for (const snap of list) {
    if (!snap.platformCampaignId) continue
    const link = await upsertPlatformLink({
      orgId: opts.orgId,
      platform: opts.adapter.platform,
      accountId: opts.adapter.accountId,
      entityType: 'campaign',
      localEntityId: snap.platformCampaignId,
      platformEntityId: snap.platformCampaignId,
    })
    if (link.localEntityId === snap.platformCampaignId) orphans++ // not yet bound to a local campaign
    await prisma.campaignSnapshot.create({
      data: {
        orgId: opts.orgId,
        platformLinkId: link.id,
        status: snap.status,
        dailyBudget: snap.dailyBudget ?? null,
        lifetimeBudget: snap.lifetimeBudget ?? null,
        bidStrategy: snap.bidStrategy ?? null,
        targeting: snap.targeting ? JSON.stringify(snap.targeting) : null,
        raw: JSON.stringify(snap.raw),
      },
    })
  }
  return { snapshotsTaken: list.length, orphans }
}

export type DriftCase =
  | 'in_sync'
  | 'platform_changed'   // platform status differs from desired
  | 'local_only'         // local campaign exists but no platform side
  | 'platform_orphan'    // platform campaign exists, no local mapping
  | 'unknown'

/**
 * detectDrift — compare the latest snapshot against Campaign.desiredStatus
 * for every active local campaign on this platform. Updates Campaign rows
 * with syncedStatus / syncedAt. Flags any drift via Campaign.syncError so the
 * UI can surface it.
 */
export async function detectDrift(opts: {
  orgId: string
  platform: string
}): Promise<{ checked: number; drifted: number; approvalsCreated: number }> {
  const campaigns = await prisma.campaign.findMany({
    where: { orgId: opts.orgId, platform: opts.platform, status: { in: ['active', 'paused'] } },
  })

  let drifted = 0
  let approvalsCreated = 0
  for (const c of campaigns) {
    const link = await prisma.platformLink.findFirst({
      where: { orgId: opts.orgId, entityType: 'campaign', localEntityId: c.id, status: 'active' },
    })
    if (!link) {
      // local-only — set syncedStatus null, no drift to report
      await prisma.campaign.update({
        where: { id: c.id },
        data: { syncedStatus: null, syncedAt: new Date() },
      })
      continue
    }
    const snap = await prisma.campaignSnapshot.findFirst({
      where: { platformLinkId: link.id },
      orderBy: { capturedAt: 'desc' },
    })
    if (!snap) continue
    const remote = snap.status as SyncedStatus
    const drift = c.desiredStatus !== remote
    if (drift) drifted++
    await prisma.campaign.update({
      where: { id: c.id },
      data: {
        syncedStatus: remote,
        syncedAt: snap.capturedAt,
        syncError: drift
          ? `Platform status (${remote}) differs from desired (${c.desiredStatus})`
          : null,
      },
    })

    // Per docs/agent/05-execution-layer.md §5.2: when a managed campaign drifts,
    // surface it for human reconciliation rather than letting the agent guess.
    if (drift && c.managedByAgent) {
      const created = await maybeCreateDriftApproval({
        orgId: opts.orgId,
        campaign: c,
        platformStatus: remote,
        platformLinkId: link.id,
      })
      if (created) approvalsCreated++
    }
  }
  return { checked: campaigns.length, drifted, approvalsCreated }
}


async function maybeCreateDriftApproval(opts: {
  orgId: string
  campaign: { id: string; name: string; desiredStatus: string }
  platformStatus: SyncedStatus
  platformLinkId: string
}): Promise<boolean> {
  // De-dup: skip if there's already a pending drift decision for this campaign.
  const existing = await prisma.decision.findFirst({
    where: {
      orgId: opts.orgId,
      status: 'pending',
      triggerType: 'webhook', // we use this trigger type for drift events
      rationale: { contains: opts.campaign.id },
    },
  })
  if (existing) return false

  const decision = await prisma.decision.create({
    data: {
      orgId: opts.orgId,
      triggerType: 'webhook',
      perceiveContext: JSON.stringify({
        kind: 'drift',
        campaignId: opts.campaign.id,
        desiredStatus: opts.campaign.desiredStatus,
        platformStatus: opts.platformStatus,
      }),
      promptVersion: 'system:drift-detector',
      rationale: `Drift detected on campaign ${opts.campaign.name} (${opts.campaign.id}): platform=${opts.platformStatus}, desired=${opts.campaign.desiredStatus}. Human should reconcile.`,
      severity: 'warning',
      mode: 'approval_only',
      status: 'pending',
      requiresApproval: true,
    },
  })
  // Drift creates a flag-only step — humans pick the right action via approval UI.
  await prisma.decisionStep.create({
    data: {
      decisionId: decision.id,
      stepIndex: 0,
      toolName: 'flag_for_review',
      toolInput: JSON.stringify({
        campaignId: opts.campaign.id,
        subject: `Campaign drift: ${opts.campaign.name}`,
        details: `Platform status is "${opts.platformStatus}" but desired is "${opts.campaign.desiredStatus}". Either re-issue the desired state or update desired to match platform.`,
      }),
      status: 'pending',
      reversible: false,
      platformLinkId: opts.platformLinkId,
    },
  })
  await prisma.pendingApproval.create({
    data: {
      orgId: opts.orgId,
      decisionId: decision.id,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    },
  })
  return true
}

/**
 * pruneOldSnapshots — keep ~30 dense days, then thin to 1/day.
 * Run from cron once a day.
 */
export async function pruneOldSnapshots(orgId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  // Hard floor: anything older than 12 months gone.
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
  await prisma.campaignSnapshot.deleteMany({
    where: { orgId, capturedAt: { lt: yearAgo } },
  })
  // Best-effort thinning: keep one per (platformLink, day) for 30d–365d range.
  const stale = await prisma.campaignSnapshot.findMany({
    where: { orgId, capturedAt: { gte: yearAgo, lt: thirtyDaysAgo } },
    select: { id: true, platformLinkId: true, capturedAt: true },
    orderBy: { capturedAt: 'asc' },
  })
  const seen = new Set<string>()
  const toDelete: string[] = []
  for (const s of stale) {
    const key = `${s.platformLinkId}-${s.capturedAt.toISOString().slice(0, 10)}`
    if (seen.has(key)) toDelete.push(s.id)
    else seen.add(key)
  }
  if (toDelete.length > 0) {
    await prisma.campaignSnapshot.deleteMany({ where: { id: { in: toDelete } } })
  }
  return { thinned: toDelete.length }
}
