/**
 * The scroll-driven embedded player: a tall host page with the viewer fixed
 * behind it, the tour engaged but paused, and the clip's position taken
 * entirely from the page's scroll offset.
 *
 * It is the acceptance test of "props first, UI second": there
 * is no progress bar on this page and no input handling, and the run is still
 * fully drivable.
 */

import { expect, test } from '@playwright/test';
import {
  expectCanvasScreenshot,
  expectChromeScreenshot,
  expectNoNewA11yViolations,
  waitForBoot,
  waitForCameraStill,
  waitForChromeIdle,
} from './support.js';

/** 0 critical/serious findings. */
const A11Y_BUDGET = 0;

/** Scrolls to a fraction of the page and waits for the readout to settle. */
async function scrollTo(page: import('@playwright/test').Page, fraction: number): Promise<void> {
  await page.evaluate((target) => {
    const range = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: range * target, behavior: 'instant' });
  }, fraction);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/scroll-tour.html');
  await waitForBoot(page, 'window.__scrollTourReady === true');
});

test('mounts with the tour engaged, paused, and no progress bar', async ({ page }) => {
  await expect(page.locator('[data-jeex="viewer"]')).toBeVisible();
  // `progressBar: false` leaves the element in the DOM and says so: the
  // machine-readable state survives the option.
  await expect(page.locator('[data-jeex="tour-bar"]')).toHaveAttribute('data-visible', 'false');
  await expect.poll(async () => page.locator('#scroll-state').textContent()).toBe('paused');
  await expect(page.locator('#scroll-fraction')).toHaveText('0.000');
});

test('scrolling moves the clip, and the readout follows', async ({ page }) => {
  await scrollTo(page, 0.5);
  await expect.poll(async () => Number(await page.locator('#scroll-fraction').textContent())).toBeGreaterThan(0.3);
  const half = Number(await page.locator('#scroll-fraction').textContent());

  await scrollTo(page, 1);
  await expect.poll(async () => Number(await page.locator('#scroll-fraction').textContent())).toBeGreaterThan(half);
  expect(Number(await page.locator('#scroll-fraction').textContent())).toBeCloseTo(1, 1);

  await scrollTo(page, 0);
  await expect.poll(async () => Number(await page.locator('#scroll-fraction').textContent())).toBeLessThan(0.05);
});

test('scrubbing by scroll really moves the camera', async ({ page }) => {
  const pose = async (): Promise<{ x: number; y: number; z: number } | null | undefined> =>
    page.evaluate(() => window.__viewerDebug?.camera());
  const start = await pose();
  expect(start).toBeTruthy();
  await scrollTo(page, 0.7);
  await expect
    .poll(async () => {
      const now = await pose();
      if (!now || !start) return 0;
      return Math.hypot(now.x - start.x, now.y - start.y, now.z - start.z);
    })
    .toBeGreaterThan(0.5);
});

test('the run stays paused: scrolling scrubs, it does not start playback', async ({ page }) => {
  await scrollTo(page, 0.4);
  await expect.poll(async () => Number(await page.locator('#scroll-fraction').textContent())).toBeGreaterThan(0.2);
  await expect(page.locator('#scroll-state')).toHaveText('paused');
});

test('the host page looks as it did', async ({ page }) => {
  await expectChromeScreenshot(page, 'scroll-tour-chrome.png');
});

test('the apartment is still being rendered behind the copy', async ({ page }) => {
  // The page opens the clip where the scroll offset is, which is an eased
  // flight; the baseline is of where it lands.
  await waitForCameraStill(page);
  // And of the resting chrome: input is off here, so the bar always collapses.
  await waitForChromeIdle(page);
  await expectCanvasScreenshot(page.locator('[data-jeex="scene-canvas"]'), 'scroll-tour-canvas.png');
});

test('accessibility: no new critical or serious violations', async ({ page }, testInfo) => {
  await expectNoNewA11yViolations(page, testInfo, A11Y_BUDGET);
});

declare global {
  interface Window {
    __scrollTourReady?: boolean;
  }
}
