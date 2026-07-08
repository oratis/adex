/**
 * Seedance2 render-seam regression guard.
 *
 * The Ark doubao-seedance-2-0 response returns the finished video URL at
 * `content.video_url` (an OBJECT) with `duration` at the top level — NOT at
 * `output.video_url`. The status route previously read `output.video_url`,
 * which is always undefined, so succeeded tasks were silently dropped and the
 * asset's `fileUrl` was never written (observed on real task
 * cgt-20260708183659-p7krf). `assetUpdateFromTask` must map a succeeded task
 * to status='ready' + fileUrl so the asset library shows the video.
 *
 * This is a pure-logic spec (no browser / DB / network): the status route's
 * Ark call is a server-side fetch Playwright cannot intercept, and the e2e CI
 * runs with no database (the lazy Prisma client throws when DATABASE_URL is
 * unset). It exercises the exact mapping the route delegates to, so the
 * fileUrl-population path is covered without stubbing infrastructure that
 * does not exist in CI. Runs in the existing Playwright runner.
 */
import { test, expect } from '@playwright/test'
import {
  assetUpdateFromTask,
  type Seedance2TaskResponse,
} from '../src/lib/platforms/seedance2'

// The shape observed from a real succeeded Ark task (cgt-20260708183659-p7krf):
// content is an object, duration/resolution/ratio are top-level, and usage
// reports completion_tokens.
const SUCCEEDED: Seedance2TaskResponse = {
  id: 'cgt-20260708183659-p7krf',
  model: 'doubao-seedance-2-0-260128',
  status: 'succeeded',
  content: {
    video_url:
      'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/gen.mp4?X-Tos-Algorithm=TOS4-HMAC-SHA256',
  },
  usage: { completion_tokens: 173700 },
  seed: 42,
  resolution: '720p',
  ratio: '9:16',
  duration: 8,
  framespersecond: 24,
  generate_audio: true,
  created_at: 1751000000,
  updated_at: 1751000200,
}

test.describe('seedance2 assetUpdateFromTask', () => {
  test('succeeded task populates fileUrl + status=ready from content.video_url', () => {
    const update = assetUpdateFromTask(SUCCEEDED)
    expect(update.status).toBe('ready')
    expect(update.fileUrl).toBe(SUCCEEDED.content!.video_url)
    expect(update.duration).toBe(8)
  })

  test('succeeded task with no video_url writes nothing (keep polling)', () => {
    const update = assetUpdateFromTask({ ...SUCCEEDED, content: null })
    expect(update).toEqual({})
  })

  test('legacy output.video_url shape still maps (defensive fallback)', () => {
    const update = assetUpdateFromTask({
      ...SUCCEEDED,
      content: null,
      output: { video_url: 'https://proxy.example/legacy.mp4' },
    })
    expect(update.status).toBe('ready')
    expect(update.fileUrl).toBe('https://proxy.example/legacy.mp4')
  })

  test('failed task maps to status=failed + errorMessage', () => {
    const update = assetUpdateFromTask({
      ...SUCCEEDED,
      status: 'failed',
      content: null,
      error: { code: 'InternalError', message: 'render worker died' },
    })
    expect(update.status).toBe('failed')
    expect(update.errorMessage).toBe('render worker died')
  })

  test('running task maps to status=generating', () => {
    const update = assetUpdateFromTask({
      ...SUCCEEDED,
      status: 'running',
      content: null,
    })
    expect(update.status).toBe('generating')
  })
})
