/**
 * Every EXPLICIT switch to 360 — the toolbar's
 * 360 button and the handle's `setMode('orbit')` (the embed protocol and the
 * element attribute call the same handle) — ends on the Reset camera pose.
 * The implicit hand-over (a grab during the tour) is pinned in
 * `src/camera/camera-director.test.ts`.
 */

import { expect, test, type Page } from '@playwright/test';
import { waitForBoot } from './support.js';
import { scaled } from './time-scale.js';

type Point = { x: number; y: number; z: number };

async function cameraPosition(page: Page): Promise<Point> {
  const point = await page.evaluate(() => window.__viewerDebug?.camera() ?? null);
  expect(point).not.toBeNull();
  return point!;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Polled rather than counted in frames: on a software rasteriser one frame
 * can take a second, and a fixed frame count ran past the test budget.
 */
async function awayFrom(page: Page, home: Point): Promise<void> {
  await expect.poll(async () => distance(await cameraPosition(page), home), { timeout: scaled(30_000) }).toBeGreaterThan(0.5);
}

async function backAt(page: Page, home: Point): Promise<void> {
  await expect.poll(async () => distance(await cameraPosition(page), home), { timeout: scaled(30_000) }).toBeLessThan(1e-3);
}

test('the 360 button and handle.setMode("orbit") both land on the Reset camera pose', async ({ page }) => {
  // The bar stays open, so both buttons are clickable without the reveal pill.
  await page.goto('/?tour=off&chromeAutoHide=0');
  await waitForBoot(page, 'window.__appReady === true');

  await page.locator('[data-jeex="reset-button"]').click();
  const home = await cameraPosition(page);

  // Through the handle: leave 360 for walk, let the walk move the camera, come back.
  await page.evaluate(() => window.jeexViewer?.setMode('walk'));
  await awayFrom(page, home);
  await page.evaluate(() => window.jeexViewer?.setMode('orbit'));
  await backAt(page, home);

  // Through the toolbar.
  await page.evaluate(() => window.jeexViewer?.setMode('walk'));
  await awayFrom(page, home);
  await page.locator('[data-jeex="mode-switcher"] [data-mode="orbit"]').click();
  await backAt(page, home);
});
