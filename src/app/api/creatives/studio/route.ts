import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { buildVariantMatrix } from '@/lib/growth/creative-brief'
import { getSpec } from '@/lib/growth/creative-specs'
import { generateCopy } from '@/lib/growth/creative-copy'

/**
 * Creative Studio — brief → DCO variant matrix with platform-fitted copy.
 *
 * GET  /api/creatives/studio            → list briefs (with variant counts)
 * GET  /api/creatives/studio?briefId=…  → one brief + its variants
 * POST /api/creatives/studio            → create a brief, fan out the matrix,
 *                                         generate fitted copy per variant
 *
 * Ref: docs/growth/03-creative-studio.md
 */
export async function GET(req: NextRequest) {
  let org
  try {
    ({ org } = await requireAuthWithOrg())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const briefId = new URL(req.url).searchParams.get('briefId')
  if (briefId) {
    const brief = await prisma.creativeBrief.findFirst({
      where: { id: briefId, orgId: org.id },
      include: { variants: { orderBy: [{ platform: 'asc' }, { format: 'asc' }] } },
    })
    if (!brief) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({ brief })
  }

  const briefs = await prisma.creativeBrief.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { variants: true } } },
  })
  return NextResponse.json({ briefs })
}

export async function POST(req: NextRequest) {
  let user, org
  try {
    ({ user, org } = await requireAuthWithOrg())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.product || !Array.isArray(body.platforms) || body.platforms.length === 0) {
    return NextResponse.json({ error: 'product and platforms are required' }, { status: 400 })
  }

  const hooks: string[] = Array.isArray(body.hooks) ? body.hooks.filter(Boolean) : []
  const languages: string[] = Array.isArray(body.languages) && body.languages.length ? body.languages : ['en']

  const brief = await prisma.creativeBrief.create({
    data: {
      orgId: org.id,
      userId: user.id,
      name: body.name || body.product,
      promotedAppId: body.promotedAppId || null,
      product: body.product,
      audience: body.audience || null,
      angle: body.angle || null,
      platforms: JSON.stringify(body.platforms),
      languages: JSON.stringify(languages),
      status: 'generating',
    },
  })

  const matrix = buildVariantMatrix({ platforms: body.platforms, hooks, languages })

  // Generate fitted copy per variant (LLM or fallback — bounded by the cap).
  const variants = await Promise.all(
    matrix.variants.map(async (v) => {
      const spec = getSpec(v.platform, v.format)
      const copy = await generateCopy(
        { product: body.product, audience: body.audience, angle: body.angle, hook: v.hook === 'default' ? null : v.hook, language: v.language },
        spec?.text ?? {},
      )
      return {
        briefId: brief.id,
        orgId: org.id,
        platform: v.platform,
        format: v.format,
        hook: v.hook === 'default' ? null : v.hook,
        language: v.language,
        headline: copy.headline ?? null,
        primaryText: copy.primaryText ?? null,
        cta: copy.cta ?? null,
        specStatus: spec?.usesStoreAssets ? 'conforms' : 'pending',
        specNotes: spec?.usesStoreAssets ? 'uses App Store product page' : null,
      }
    }),
  )

  if (variants.length) await prisma.creativeVariant.createMany({ data: variants })
  await prisma.creativeBrief.update({ where: { id: brief.id }, data: { status: 'ready' } })

  return NextResponse.json({ ok: true, briefId: brief.id, variants: variants.length, total: matrix.total, truncated: matrix.truncated })
}
