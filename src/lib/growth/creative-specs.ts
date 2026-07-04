/**
 * Platform creative-spec registry + conformance validation (pure). The core of
 * Adex's material (物料) capability: what each platform/placement requires of an
 * ad asset, and whether a produced asset conforms (or needs transcode/resize).
 *
 * Specs are grounded in published platform guidance (2025–26) and are meant to
 * be edited as platforms change — one place, not scattered across the code.
 * Sources: TikTok in-feed (9:16 1080×1920, 5–60s, ≤500MB, caption 12–100);
 * Meta Reels/Feed; Google App campaign assets; Apple Search Ads (store assets).
 *
 * Ref: docs/growth/03-creative-studio.md
 */

export type CreativeKind = 'video' | 'image' | 'text_only'

export interface TextLimits {
  headlineMax?: number
  primaryTextMax?: number
  descriptionMax?: number
  ctaMax?: number
}

export interface CreativeSpec {
  platform: string // meta | tiktok | google | asa
  format: string // reels_9x16 | feed_1x1 | in_feed_9x16 | uac_video | search
  label: string
  kind: CreativeKind
  aspectRatios: string[] // e.g. ['9:16'] — parsed as w:h
  minWidth?: number
  minHeight?: number
  recommendedWidth?: number
  recommendedHeight?: number
  minDurationSec?: number
  maxDurationSec?: number
  recommendedMaxDurationSec?: number
  maxFileMB?: number
  fileTypes?: string[]
  text: TextLimits
  /** ASA: creative = the App Store product page, nothing to upload. */
  usesStoreAssets?: boolean
}

const SPECS: CreativeSpec[] = [
  {
    platform: 'tiktok', format: 'in_feed_9x16', label: 'TikTok In-Feed', kind: 'video',
    aspectRatios: ['9:16'], minWidth: 540, minHeight: 960, recommendedWidth: 1080, recommendedHeight: 1920,
    minDurationSec: 5, maxDurationSec: 60, recommendedMaxDurationSec: 15, maxFileMB: 500, fileTypes: ['mp4', 'mov', 'mpeg', 'avi'],
    text: { headlineMax: 100, ctaMax: 20 }, // caption 12–100
  },
  {
    platform: 'meta', format: 'reels_9x16', label: 'Meta Reels/Stories', kind: 'video',
    aspectRatios: ['9:16'], minWidth: 500, minHeight: 888, recommendedWidth: 1080, recommendedHeight: 1920,
    minDurationSec: 0, maxDurationSec: 90, recommendedMaxDurationSec: 15, maxFileMB: 4096, fileTypes: ['mp4', 'mov'],
    text: { headlineMax: 40, primaryTextMax: 125, descriptionMax: 30 },
  },
  {
    platform: 'meta', format: 'feed_1x1', label: 'Meta Feed (square)', kind: 'image',
    aspectRatios: ['1:1', '4:5'], minWidth: 600, minHeight: 600, recommendedWidth: 1080, recommendedHeight: 1080,
    maxFileMB: 30, fileTypes: ['jpg', 'jpeg', 'png'],
    text: { headlineMax: 40, primaryTextMax: 125, descriptionMax: 30 },
  },
  {
    platform: 'google', format: 'uac_video', label: 'Google App (video)', kind: 'video',
    aspectRatios: ['9:16', '16:9', '1:1'], minWidth: 480, minHeight: 480, recommendedWidth: 1080, recommendedHeight: 1920,
    minDurationSec: 10, maxDurationSec: 30, recommendedMaxDurationSec: 30, maxFileMB: 1024, fileTypes: ['mp4', 'mov'],
    text: { headlineMax: 30, descriptionMax: 90 },
  },
  {
    platform: 'asa', format: 'search', label: 'Apple Search Ads', kind: 'text_only',
    aspectRatios: [], usesStoreAssets: true,
    text: {}, // ASA renders the App Store product page; no uploaded creative
  },
]

export function listSpecs(): CreativeSpec[] {
  return SPECS
}

export function getSpec(platform: string, format: string): CreativeSpec | undefined {
  return SPECS.find((s) => s.platform === platform && s.format === format)
}

export function formatsForPlatform(platform: string): CreativeSpec[] {
  return SPECS.filter((s) => s.platform === platform)
}

/** Parse "9:16" → 0.5625 (w/h). Returns null if unparseable. */
export function ratioValue(ar: string): number | null {
  const [w, h] = ar.split(':').map(Number)
  if (!w || !h) return null
  return w / h
}

export interface AssetMeta {
  kind: CreativeKind
  width?: number
  height?: number
  durationSec?: number
  fileSizeMB?: number
  fileType?: string // extension, lowercase, no dot
}

export type SpecStatus = 'conforms' | 'needs_resize' | 'needs_transcode' | 'rejected' | 'not_applicable'

export interface ConformanceResult {
  status: SpecStatus
  issues: string[]
}

const RATIO_TOLERANCE = 0.02

/**
 * Validate an asset against a spec. Distinguishes fixable issues:
 *  - needs_resize     — wrong dimensions / aspect ratio (re-render or crop)
 *  - needs_transcode  — too long, too big, or wrong container (re-encode)
 *  - rejected         — wrong kind (e.g. image where video required)
 */
export function validateCreative(asset: AssetMeta, spec: CreativeSpec): ConformanceResult {
  if (spec.usesStoreAssets) return { status: 'not_applicable', issues: ['uses App Store product page — no uploaded creative'] }

  const issues: string[] = []
  let needsResize = false
  let needsTranscode = false

  if (asset.kind !== spec.kind) {
    return { status: 'rejected', issues: [`kind ${asset.kind} ≠ required ${spec.kind}`] }
  }

  // Aspect ratio
  if (spec.aspectRatios.length && asset.width && asset.height) {
    const actual = asset.width / asset.height
    const match = spec.aspectRatios.some((ar) => {
      const v = ratioValue(ar)
      return v !== null && Math.abs(actual - v) <= RATIO_TOLERANCE
    })
    if (!match) { issues.push(`aspect ${asset.width}×${asset.height} not in [${spec.aspectRatios.join(', ')}]`); needsResize = true }
  }

  // Resolution floor
  if (spec.minWidth && asset.width && asset.width < spec.minWidth) { issues.push(`width ${asset.width} < min ${spec.minWidth}`); needsResize = true }
  if (spec.minHeight && asset.height && asset.height < spec.minHeight) { issues.push(`height ${asset.height} < min ${spec.minHeight}`); needsResize = true }

  // Duration
  if (asset.durationSec !== undefined) {
    if (spec.maxDurationSec !== undefined && asset.durationSec > spec.maxDurationSec) { issues.push(`duration ${asset.durationSec}s > max ${spec.maxDurationSec}s`); needsTranscode = true }
    if (spec.minDurationSec !== undefined && asset.durationSec < spec.minDurationSec) { issues.push(`duration ${asset.durationSec}s < min ${spec.minDurationSec}s`); needsTranscode = true }
  }

  // File size
  if (spec.maxFileMB !== undefined && asset.fileSizeMB !== undefined && asset.fileSizeMB > spec.maxFileMB) { issues.push(`file ${asset.fileSizeMB}MB > max ${spec.maxFileMB}MB`); needsTranscode = true }

  // Container / type
  if (spec.fileTypes && asset.fileType && !spec.fileTypes.includes(asset.fileType)) { issues.push(`type .${asset.fileType} not in [${spec.fileTypes.join(', ')}]`); needsTranscode = true }

  if (needsTranscode) return { status: 'needs_transcode', issues }
  if (needsResize) return { status: 'needs_resize', issues }
  return { status: 'conforms', issues: [] }
}
