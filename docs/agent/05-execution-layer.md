# 05 · Platform 执行层

> 这是修复 [02-gap-analysis.md](./02-gap-analysis.md) 中"致命断链 A/B/C"的核心改造。

## 1. 问题回顾

当前 `src/lib/platforms/*.ts` 每个 client 接口都不一样：

- Google `createCampaign(customerId, params)` 返回 `unknown`
- Meta `createCampaign(params)` 返回 `Promise<any>`
- TikTok `createCampaign(params)` 返回 `Promise<any>`
- 没有 `createAd`、`adjustBudget`、`createAdGroup` 的统一签名
- launch 路由内部 `switch (platform)` 各自写死 if-else

Agent Runtime 不可能在这种基础上调用 tool，必须先把执行层抽干净。

## 2. PlatformAdapter 接口设计

### 2.1 顶层接口

```ts
// src/lib/platforms/adapter.ts

export type PlatformName = 'google' | 'meta' | 'tiktok' | 'amazon' | 'linkedin'

export interface PlatformAdapter {
  readonly platform: PlatformName

  // ============ 元信息 ============
  validateAuth(): Promise<{ ok: true } | { ok: false; reason: string }>
  listAccounts(): Promise<PlatformAccount[]>

  // ============ 写：Campaign 级 ============
  launchCampaign(input: LaunchCampaignInput): Promise<LaunchCampaignResult>
  updateCampaignStatus(linkId: string, status: 'active' | 'paused'): Promise<void>
  updateCampaignBudget(linkId: string, daily: number): Promise<void>
  cloneCampaign(linkId: string, overrides?: Partial<LaunchCampaignInput>): Promise<LaunchCampaignResult>
  deleteCampaign(linkId: string): Promise<void>

  // ============ 写：AdGroup / Ad / Creative ============
  createAdGroup(input: CreateAdGroupInput): Promise<{ platformAdGroupId: string }>
  updateAdGroupStatus(linkId: string, status: 'active' | 'paused'): Promise<void>
  uploadCreativeAsset(input: UploadCreativeInput): Promise<{ platformAssetId: string }>
  createAd(input: CreateAdInput): Promise<{ platformAdId: string }>
  pauseAd(linkId: string): Promise<void>

  // ============ 读 ============
  fetchAccountReport(range: DateRange): Promise<AccountReport>
  fetchCampaignReports(range: DateRange, filter?: { campaignLinkIds?: string[] }): Promise<CampaignReport[]>
  fetchCampaignSnapshots(filter?: { campaignLinkIds?: string[] }): Promise<CampaignSnapshot[]>
}
```

### 2.2 输入输出统一类型

```ts
// src/lib/platforms/types.ts

export interface LaunchCampaignInput {
  name: string
  objective: 'awareness' | 'consideration' | 'conversion' | 'app_install'
  channel?: 'search' | 'display' | 'video' | 'shopping' | 'feed' | 'auto'
  budget: { type: 'daily' | 'lifetime'; amount: number; currency: string }
  bidStrategy?: 'maximize_clicks' | 'target_cpa' | 'target_roas' | 'manual_cpc'
  bidAmount?: number
  targeting: {
    countries?: string[]
    languages?: string[]
    ageRange?: [number, number]
    genders?: ('male' | 'female' | 'all')[]
    interests?: string[]
    placements?: string[]
  }
  schedule?: { startDate: string; endDate?: string }
  status?: 'paused' | 'active'   // 默认 paused
  adGroups?: AdGroupSpec[]       // 可选：launch 时一并创建
}

export interface AdGroupSpec {
  name: string
  ads: AdSpec[]
}

export interface AdSpec {
  name: string
  creativeLocalId: string        // 本地 Creative.id；adapter 内部解析
  headline?: string
  description?: string
  callToAction?: string
  destinationUrl: string
}

export class PlatformError extends Error {
  constructor(
    public code: 'rate_limit' | 'auth_expired' | 'invalid_argument' | 'platform_outage' | 'not_found' | 'unknown',
    message: string,
    public retryAfterMs?: number,
    public platformDetails?: unknown
  ) {
    super(message)
  }
}
```

### 2.3 BaseAdapter（公共逻辑）

```ts
// src/lib/platforms/base-adapter.ts

export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly platform: PlatformName

  constructor(
    protected readonly auth: PlatformAuth,
    protected readonly orgId: string,
    protected readonly db: PrismaClient
  ) {}

  // 公共能力：写回 PlatformLink、统一错误转译、token refresh hook
  protected async upsertLink(input: {
    entityType: 'campaign' | 'adgroup' | 'ad' | 'creative'
    localEntityId: string
    platformEntityId: string
    metadata?: object
  }): Promise<PlatformLink> {
    return this.db.platformLink.upsert({
      where: {
        platform_accountId_platformEntityId_entityType: {
          platform: this.platform,
          accountId: this.auth.accountId!,
          platformEntityId: input.platformEntityId,
          entityType: input.entityType,
        },
      },
      create: {
        orgId: this.orgId,
        platform: this.platform,
        accountId: this.auth.accountId!,
        entityType: input.entityType,
        localEntityId: input.localEntityId,
        platformEntityId: input.platformEntityId,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
      update: {
        localEntityId: input.localEntityId,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
        lastSyncedAt: new Date(),
      },
    })
  }

  protected async withRetry<T>(fn: () => Promise<T>, opts?: { maxAttempts?: number }): Promise<T> {
    const max = opts?.maxAttempts ?? 3
    let lastErr: unknown
    for (let i = 0; i < max; i++) {
      try {
        return await fn()
      } catch (err) {
        lastErr = err
        if (err instanceof PlatformError && err.code === 'rate_limit') {
          await new Promise(r => setTimeout(r, err.retryAfterMs ?? 1000 * 2 ** i))
          continue
        }
        if (err instanceof PlatformError && err.code === 'auth_expired') {
          await this.refreshAuth()
          continue
        }
        throw err
      }
    }
    throw lastErr
  }

  protected abstract refreshAuth(): Promise<void>
  // ... 子类实现 launchCampaign 等
}
```

## 3. GoogleAdsAdapter 重构示例（重点）

```ts
// src/lib/platforms/google/adapter.ts

export class GoogleAdsAdapter extends BaseAdapter {
  readonly platform = 'google' as const
  private client: GoogleAdsClient   // 现有 client.ts 保留作为底层 HTTP wrapper

  async launchCampaign(input: LaunchCampaignInput): Promise<LaunchCampaignResult> {
    return this.withRetry(async () => {
      const cid = this.auth.accountId!.replace(/[-\s]/g, '')

      // 1. 创建 budget
      const budget = await this.client.createCampaignBudget(cid, {
        name: `${input.name}_budget`,
        amountMicros: input.budget.amount * 1_000_000,
        deliveryMethod: 'STANDARD',
      })

      // 2. 创建 campaign（带 channel + bid strategy + status）
      const campaign = await this.client.createCampaign(cid, {
        name: input.name,
        advertisingChannelType: this.mapChannel(input.channel ?? this.defaultChannelFor(input.objective)),
        status: input.status === 'active' ? 'ENABLED' : 'PAUSED',
        campaignBudget: budget.resourceName,
        biddingStrategyType: this.mapBidStrategy(input.bidStrategy ?? 'maximize_clicks'),
        targetCpa: input.bidStrategy === 'target_cpa' ? { targetCpaMicros: (input.bidAmount ?? 0) * 1e6 } : undefined,
        startDate: input.schedule?.startDate.replace(/-/g, ''),
        endDate: input.schedule?.endDate?.replace(/-/g, ''),
      })

      const platformCampaignId = campaign.resourceName.split('/').pop()!

      // 3. 推 targeting（GeoTargeting / Demographics / etc.）
      if (input.targeting.countries?.length) {
        await this.client.applyCampaignCriteria(cid, platformCampaignId, {
          countries: input.targeting.countries,
          languages: input.targeting.languages,
          ageRange: input.targeting.ageRange,
          genders: input.targeting.genders,
        })
      }

      // 4. 写回 PlatformLink（核心断链 C 修复）
      const link = await this.upsertLink({
        entityType: 'campaign',
        localEntityId: input.localCampaignId,   // 调用方传入
        platformEntityId: platformCampaignId,
        metadata: { budgetResourceName: budget.resourceName },
      })

      // 5. 创建 AdGroup + Ad（如果 input 提供）
      const createdAdGroups: { localId: string; platformId: string; ads: { localId: string; platformId: string }[] }[] = []
      for (const ag of input.adGroups ?? []) {
        const adGroupResult = await this.createAdGroupInternal(cid, platformCampaignId, ag)
        createdAdGroups.push(adGroupResult)
      }

      return {
        platformCampaignId,
        linkId: link.id,
        adGroups: createdAdGroups,
      }
    })
  }

  async updateCampaignStatus(linkId: string, status: 'active' | 'paused'): Promise<void> {
    const link = await this.db.platformLink.findUniqueOrThrow({ where: { id: linkId } })
    return this.withRetry(async () => {
      const cid = link.accountId.replace(/[-\s]/g, '')
      await this.client.mutateCampaign(cid, {
        update: {
          resourceName: `customers/${cid}/campaigns/${link.platformEntityId}`,
          status: status === 'active' ? 'ENABLED' : 'PAUSED',
        },
        updateMask: 'status',
      })
      await this.db.platformLink.update({
        where: { id: linkId },
        data: { lastSyncedAt: new Date(), metadata: JSON.stringify({ ...JSON.parse(link.metadata ?? '{}'), syncedStatus: status }) },
      })
    })
  }

  async updateCampaignBudget(linkId: string, daily: number): Promise<void> {
    // ... 类似，调用 campaignBudgets:mutate
  }

  // ... 其余方法
}
```

## 4. launch route 的简化

```ts
// src/app/api/campaigns/[id]/launch/route.ts （重构后）

export async function POST(req: NextRequest, { params }: Ctx) {
  const { user, org } = await requireAuthWithOrg()
  const { id } = await params

  const campaign = await prisma.campaign.findFirstOrThrow({
    where: { id, orgId: org.id },
    include: { budgets: true, adGroups: { include: { ads: { include: { creative: true } } } } },
  })

  const adapter = await getAdapter(org.id, campaign.platform)
  const result = await adapter.launchCampaign({
    localCampaignId: campaign.id,
    name: campaign.name,
    objective: campaign.objective ?? 'awareness',
    budget: { type: campaign.budgets[0]?.type ?? 'daily', amount: campaign.budgets[0]?.amount ?? 50, currency: 'USD' },
    targeting: {
      countries: campaign.targetCountries ? JSON.parse(campaign.targetCountries) : undefined,
      ageRange: campaign.ageMin && campaign.ageMax ? [campaign.ageMin, campaign.ageMax] : undefined,
      genders: campaign.gender && campaign.gender !== 'all' ? [campaign.gender as 'male' | 'female'] : undefined,
    },
    schedule: campaign.startDate ? { startDate: campaign.startDate.toISOString().slice(0, 10), endDate: campaign.endDate?.toISOString().slice(0, 10) } : undefined,
    adGroups: campaign.adGroups.map(ag => ({
      name: ag.name,
      ads: ag.ads.map(ad => ({
        name: ad.name,
        creativeLocalId: ad.creativeId!,
        headline: ad.headline ?? undefined,
        description: ad.description ?? undefined,
        callToAction: ad.callToAction ?? undefined,
        destinationUrl: ad.destinationUrl!,
      })),
    })),
    status: 'paused',  // 永远 paused 落地，让用户/agent 单独决定何时启动
  })

  await prisma.campaign.update({
    where: { id },
    data: { desiredStatus: 'paused', syncedStatus: 'paused', syncedAt: new Date() },
  })

  await logAudit({ /* ... */ })
  await fireWebhook({ event: 'campaign.launched', data: { ... } })

  return NextResponse.json({ success: true, ...result })
}

async function getAdapter(orgId: string, platform: string): Promise<PlatformAdapter> {
  const auth = await prisma.platformAuth.findFirstOrThrow({ where: { orgId, platform, isActive: true } })
  switch (platform) {
    case 'google':   return new GoogleAdsAdapter(auth, orgId, prisma)
    case 'meta':     return new MetaAdsAdapter(auth, orgId, prisma)
    case 'tiktok':   return new TikTokAdsAdapter(auth, orgId, prisma)
    case 'amazon':   return new AmazonAdsAdapter(auth, orgId, prisma)
    case 'linkedin': return new LinkedInAdsAdapter(auth, orgId, prisma)
    default: throw new Error(`Unsupported platform: ${platform}`)
  }
}
```

## 5. 双向同步（P12）

### 5.1 Sync Worker 流程

```
Cloud Tasks → POST /api/internal/sync/account
  body: { orgId, platform }
  ↓
1. getAdapter(orgId, platform).fetchCampaignSnapshots()
2. For each snapshot:
     a. upsert PlatformLink (entityType=campaign)
     b. write CampaignSnapshot row
     c. detect drift: snapshot.status vs Campaign.desiredStatus
        if drift AND Campaign.managedByAgent: enqueue reconcile task
3. fetchCampaignReports(range=last 7d, filter=active campaigns)
4. upsert Report rows at level=campaign + level=account
5. fire webhook "sync.completed"
```

### 5.2 Drift handling

```
desired vs synced 对比 → 4 种处理：
  A. desired=paused, synced=paused → 一致，无操作
  B. desired=paused, synced=active → 平台被人工恢复了
       - managedByAgent=false: 信任人工，更新 desired=active
       - managedByAgent=true: 创建审批 "agent 检测到外部修改，是否重新暂停？"
  C. desired=active, synced=paused → 平台被人工/政策暂停
       - 通知用户 + 标记 Campaign.syncError
  D. 全新 platform campaign 在本地无对应 → 自动创建本地 shadow Campaign
```

### 5.3 频率
- 默认每小时 sync 一次。
- 高消费账号（日 spend > $1000）每 15 分钟。
- 用户手动 sync → 立即入队（去重 1 分钟内同 key 只跑一次）。

## 6. 错误处理 / 退避策略

| 错误码 | 处理 |
|---|---|
| `rate_limit` | 指数退避 + jitter，最多 5 次 |
| `auth_expired` | 触发 refresh，refresh 失败则标记 `PlatformAuth.isActive=false` 通知用户 |
| `invalid_argument` | 不重试，写 `DecisionStep.toolOutput` + alert |
| `platform_outage` | 5 分钟后重试，3 次失败后写入 incident |
| `not_found` | 不重试；标记本地实体 `syncedStatus='orphan'` |
| `unknown` | 1 次重试，仍失败则记录 raw response 供 debug |

## 7. 实施步骤（与 Phase 对齐）

| 步骤 | Phase | 验收 |
|---|---|---|
| 写 PlatformAdapter / BaseAdapter / 类型 | P10 | `tsc --noEmit` 通过 |
| 实现 GoogleAdsAdapter（launch + status + budget） | P10 | Playwright e2e: 创建 → launch → 平台真实出现一个 PAUSED campaign |
| 实现 MetaAdsAdapter | P10 | 同上 |
| 实现 TikTokAdsAdapter | P10 | 同上 |
| 重构 launch route 使用 adapter | P10 | 单元 + e2e |
| Sync Worker（campaign 粒度报表） | P11 | Report 表出现 level=campaign 行 |
| Snapshot + drift detection | P12 | 手工在 Google 后台改 status，下次 sync 后本地 syncedStatus 同步 |
| Amazon / LinkedIn adapter | P12 后 | 优先级低，可延后 |
