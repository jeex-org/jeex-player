/**
 * The REAL `WEBGL_lose_context` loss/restore path.
 *
 * `render-runtime.test.ts` and `context-recovery.test.ts` already cover this
 * behaviour with a synthetic `webglcontextlost`/`webglcontextrestored` event
 * dispatch; `scripts/browser-check/lifecycle.ts`'s `checkContextLoss` already
 * exercises the real extension, but only as an exploratory tool CI never
 * runs. The real extension has to be a GATE, so this file mirrors `checkContextLoss`
 * exactly — same events, same assertions — as a Playwright test that
 * `check.sh`'s e2e step actually runs.
 *
 * `scripts/browser-check/lifecycle.ts` keeps its own copy: it is the
 * exploratory tool, not a duplicate of this gate.
 */

import { expect, test } from '@playwright/test';
import { expectCanvasStillRendering, serveKtx2LibraryProject, waitForBoot } from './support.js';
import { scaled } from './time-scale.js';
import { LIBRARY_PROJECT_FIXTURE } from '../fixtures/project/fixture-ids.js';

/** How long a restored context may take to reach a drawn frame, ms — the whole document rebuilds on a GPU that just came back. */
const RESTORE_TIMEOUT_MS = scaled(20_000);

test('a real WEBGL_lose_context loss raises the card and the context-lost event, and restoreContext() brings the scene back', async ({
  page,
}) => {
  await page.goto('/');
  await waitForBoot(page, 'window.__appReady === true');

  await expect(page.locator('[data-jeex="error-state"]')).toBeHidden();
  await expect(page.locator('[data-jeex="viewer-ui"]')).toBeVisible();

  // The host's own subscriptions, armed BEFORE the loss: `context-lost` has to
  // reach a page that only ever listens to the public event, not just the
  // card (mirrors `checkContextLoss`), and `ready` firing again on restore is
  // only provable by a listener that was already there when it happened.
  const hasExtension = await page.evaluate(() => {
    window.__jeexErrors = [];
    window.__jeexReadyCount = 0;
    window.jeexViewer?.on('error', (error: { code: string }) => window.__jeexErrors?.push(error.code));
    window.jeexViewer?.on('ready', () => {
      window.__jeexReadyCount = (window.__jeexReadyCount ?? 0) + 1;
    });
    const canvas = document.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    window.__jeexLose = gl?.getExtension('WEBGL_lose_context') ?? null;
    return Boolean(window.__jeexLose);
  });
  expect(hasExtension, 'the browser must expose WEBGL_lose_context for this test to mean anything').toBe(true);

  await page.evaluate(() => window.__jeexLose?.loseContext());
  await expect.poll(async () => page.evaluate(() => window.__jeexErrors?.includes('context-lost'))).toBe(true);

  await expect(page.locator('[data-jeex="error-state"]')).toBeVisible();
  await expect(page.locator('[data-jeex="viewer-ui"]')).toBeHidden();
  expect(await page.evaluate(() => window.__jeexReadyCount)).toBe(0);

  await page.evaluate(() => window.__jeexLose?.restoreContext());
  // A predicate, not a duration: the card comes down when the re-mounted
  // document is on screen, and how long that takes is the GPU's business.
  await expect(page.locator('[data-jeex="error-state"]')).toBeHidden({ timeout: RESTORE_TIMEOUT_MS });
  await expect
    .poll(async () => page.evaluate(() => window.__viewerDebug?.rooms().length ?? 0), { timeout: RESTORE_TIMEOUT_MS })
    .toBeGreaterThan(0);

  await expect(page.locator('[data-jeex="viewer-ui"]')).toBeVisible();
  await expect(page.locator('[data-jeex="scene-canvas"]')).toHaveCount(1);
  // `ready` fires again for the re-mounted document — the listener armed
  // before the loss is the proof, not a fresh one that would trivially fire.
  await expect.poll(async () => page.evaluate(() => window.__jeexReadyCount ?? 0)).toBeGreaterThan(0);

  // The restored canvas is actually DRAWING again, not merely back in the
  // DOM: a real compositor screenshot of the apartment, same tolerance as
  // every other canvas baseline (`expectCanvasScreenshot`).
  await expectCanvasStillRendering(page.locator('[data-jeex="scene-canvas"]'), 'context-loss-restored-canvas.png');
});

test('a restored context draws a library project’s maps again from the bytes it kept, with no new texture request', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (sent) => {
    if (sent.url().includes('/tests/fixtures/project-library/tex/')) requested.push(sent.url());
  });
  await page.goto('/dev/project.html?project=/tests/fixtures/project-library/project.json');
  await waitForBoot(page, 'window.__appReady === true');
  const floor = `floor-${LIBRARY_PROJECT_FIXTURE.room.living}`;
  const hasMaps = (name: string) => (window.__viewerDebug!.surfaceMaterial(name)?.maps.length ?? 0) > 0;
  await page.waitForFunction(hasMaps, floor, { timeout: RESTORE_TIMEOUT_MS });
  const before = requested.length;
  expect(before).toBe(3);

  const hasExtension = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    window.__jeexLose = gl?.getExtension('WEBGL_lose_context') ?? null;
    return Boolean(window.__jeexLose);
  });
  expect(hasExtension, 'the browser must expose WEBGL_lose_context for this test to mean anything').toBe(true);
  await page.evaluate(() => window.__jeexLose?.loseContext());
  await expect(page.locator('[data-jeex="error-state"]')).toBeVisible();
  await page.evaluate(() => window.__jeexLose?.restoreContext());
  await expect(page.locator('[data-jeex="error-state"]')).toBeHidden({ timeout: RESTORE_TIMEOUT_MS });

  // The project came back as a PROJECT: its own library material on the floor, maps and all.
  await page.waitForFunction(hasMaps, floor, { timeout: RESTORE_TIMEOUT_MS });
  expect(await page.evaluate((name) => window.__viewerDebug!.surfaceMaterial(name)?.maps, floor)).toEqual([
    'map',
    'normalMap',
    'aoMap',
    'roughnessMap',
    'metalnessMap',
  ]);
  expect(requested).toHaveLength(before);
});

test('a restored context draws KTX2 maps again from the bytes it kept: no new map or transcoder request', async ({ page, request }) => {
  const served = await serveKtx2LibraryProject(page, request);
  await page.goto('/dev/project.html?project=/tests/fixtures/project-library/project.json');
  await waitForBoot(page, 'window.__appReady === true');
  const floor = `floor-${LIBRARY_PROJECT_FIXTURE.room.living}`;
  const hasMaps = (name: string) => (window.__viewerDebug!.surfaceMaterial(name)?.maps.length ?? 0) > 0;
  await page.waitForFunction(hasMaps, floor, { timeout: RESTORE_TIMEOUT_MS });
  expect([served.maps().length, served.transcoder()]).toEqual([3, { js: 1, wasm: 1 }]);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    window.__jeexLose = gl?.getExtension('WEBGL_lose_context') ?? null;
  });
  await page.evaluate(() => window.__jeexLose?.loseContext());
  await expect(page.locator('[data-jeex="error-state"]')).toBeVisible();
  await page.evaluate(() => window.__jeexLose?.restoreContext());
  await expect(page.locator('[data-jeex="error-state"]')).toBeHidden({ timeout: RESTORE_TIMEOUT_MS });
  await page.waitForFunction(hasMaps, floor, { timeout: RESTORE_TIMEOUT_MS });
  expect(await page.evaluate((name) => window.__viewerDebug!.surfaceMaterial(name)?.maps, floor)).toEqual([
    'map',
    'normalMap',
    'aoMap',
    'roughnessMap',
    'metalnessMap',
  ]);
  expect([served.maps().length, served.transcoder()]).toEqual([3, { js: 1, wasm: 1 }]);
});

declare global {
  interface Window {
    __jeexErrors?: string[];
    __jeexReadyCount?: number;
    __jeexLose?: WEBGL_lose_context | null;
  }
}
