import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { getSpec } from '@/lib/growth/creative-specs'
import { buildStoryboard } from '@/lib/growth/storyboard'

/**
 * POST /api/creatives/studio/produce  { variantId }
 *
 * Turn a CreativeVariant into a produced Creative: composes the storyboard
 * (hook→scene→end-card) + copy into a generation prompt and creates a
 * review-gated Creative (source=agent, status=generating), linking it back to
 * the variant. The actual media render (Seedance2/Seedream) is the existing
 * generation flow / a credentialed follow-up; this lays down the exact brief.
 *
 * ASA variants use the App Store product page → nothing to produce.
 *
 * Ref: docs/growth/03-creative-studio.md
 */
export async function POST(req: NextRequest) {
  let user, org
  try {
    ({ user, org } = await requireAuthWithOrg())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { variantId } = (await req.json().catch(() => ({}))) as { variantId?: string }
  if (!variantId) return NextResponse.json({ error: 'variantId required' }, { status: 400 })

  const variant = await prisma.creativeVariant.findFirst({
    where: { id: variantId, orgId: org.id },
    include: { brief: true },
  })
  if (!variant) return NextResponse.json({ error: 'variant not found' }, { status: 404 })

  const spec = getSpec(variant.platform, variant.format)
  if (spec?.usesStoreAssets) {
    return NextResponse.json({ ok: true, skipped: 'uses App Store product page — no creative to produce' })
  }

  const kind = spec?.kind === 'image' ? 'image' : 'video'
  const storyboard = buildStoryboard({
    product: variant.brief.product,
    hook: variant.hook,
    cta: variant.cta,
  })

  const promptLines = [
    `Format: ${variant.platform}/${variant.format} (${spec?.aspectRatios.join(', ') ?? ''})`,
    variant.headline ? `Headline: ${variant.headline}` : null,
    variant.cta ? `CTA: ${variant.cta}` : null,
    ...storyboard.segments.map((s) => `[${s.startSec}s ${s.role}] ${s.sourceRef ? `scene ${s.sourceRef}` : s.prompt}`),
  ].filter(Boolean)

  const creative = await prisma.creative.create({
    data: {
      orgId: org.id,
      userId: user.id,
      name: `${variant.brief.name} · ${variant.platform}/${variant.format}`.slice(0, 80),
      type: kind,
      source: 'agent',
      prompt: promptLines.join('\n'),
      status: 'generating',
      reviewStatus: 'pending',
      width: spec?.recommendedWidth ?? null,
      height: spec?.recommendedHeight ?? null,
      duration: kind === 'video' ? Math.round(storyboard.totalSec) : null,
    },
  })

  await prisma.creativeVariant.update({ where: { id: variant.id }, data: { creativeId: creative.id } })

  return NextResponse.json({ ok: true, creativeId: creative.id, kind, storyboard })
}
