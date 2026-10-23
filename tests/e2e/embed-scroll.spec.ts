/**
 * The cooperative wheel on a real page (focus and embedding): a viewer
 * embedded in a page that scrolls leaves the plain wheel and Space to the page
 * until it is engaged, answers Ctrl + wheel at once, and says so with the
 * «Ctrl + scroll to zoom» plate.
 *
 * Real mouse-wheel and keyboard input through Playwright, because what is
 * proved here is the BROWSER's default action (the page scroll) — a synthetic
 * event dispatched to the canvas scrolls nothing whatever the viewer does.
 */

import { expect, test, type Page } from '@playwright/test';
import { waitForBoot, waitForCameraStill } from './support.js';
import { scaled } from './time-scale.js';

type Pose = { x: number; y: number; z: number };

async function camera(page: Page): Promise<Pose> {
  const pose = await page.evaluate(() => window.__viewerDebug?.camera());
  if (!pose) throw new Error('embed-scroll: no camera pose');
  return pose;
}

function moved(a: Pose, b: Pose): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

async function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

/** The pointer over the middle of the scene canvas. */
async function hoverScene(page: Page): Promise<void> {
  const box = await page.locator('#stage [data-jeex="scene-canvas"]').boundingBox();
  if (!box) throw new Error('embed-scroll: the canvas has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * The headless SwiftShader page renders at a few frames per second, so a
 * round trip from the test can arrive after the plate's 1.5 s is over. The
 * page itself records that the plate went up, the moment it did.
 */
async function watchPlate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const plate = document.querySelector<HTMLElement>('[data-jeex="scroll-hint"]');
    if (!plate) throw new Error('embed-scroll: no plate');
    window.__plateShown = false;
    new MutationObserver(() => {
      if (plate.dataset['visible'] === 'true') window.__plateShown = true;
    }).observe(plate, { attributes: true, attributeFilter: ['data-visible'] });
  });
}

/** Polls until the camera has moved more than `metres` away from `from`. */
async function expectCameraMoved(page: Page, from: Pose, metres: number): Promise<void> {
  await expect.poll(async () => moved(from, await camera(page)), { timeout: scaled(30_000) }).toBeGreaterThan(metres);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/embed-scroll.html');
  await waitForBoot(page, 'window.__embedScrollReady === true');
  await waitForCameraStill(page);
  await watchPlate(page);
});

test('an unfocused viewer lets a plain wheel scroll the page, and shows how to zoom', async ({ page }) => {
  const before = await camera(page);
  await hoverScene(page);
  await page.mouse.wheel(0, 240);
  await expect.poll(async () => scrollY(page)).toBeGreaterThan(0);
  await expect.poll(async () => page.evaluate(() => window.__plateShown)).toBe(true);
  await waitForCameraStill(page);
  expect(moved(before, await camera(page))).toBeLessThan(1e-3);
  // The plate goes on its own.
  await expect(page.locator('[data-jeex="scroll-hint"]')).toHaveAttribute('data-visible', 'false', { timeout: scaled(5_000) });
});

test('Ctrl + wheel zooms the unfocused viewer and leaves the page where it was', async ({ page }) => {
  const before = await camera(page);
  await hoverScene(page);
  const top = await scrollY(page);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await expectCameraMoved(page, before, 0.1);
  expect(await scrollY(page)).toBe(top);
  expect(await page.evaluate(() => window.__plateShown)).toBe(false);
});

/** How long the camera may take to settle after a wheel, on a frame-bound budget (see the test). */
const SETTLE_AFTER_WHEEL_MS = scaled(90_000);

test('once clicked, the viewer owns the wheel and Space: the page stays put', async ({ page }) => {
  // Frame-bound, not stuck: every protocol call below (the hover, the press,
  // the release, Escape, each camera read and wheel) waits behind the frame in
  // flight, and this test makes about fifteen of them after the boot. On
  // SwiftShader on a loaded machine a frame of this page took about 3 s, and
  // the steps up to the second camera wait alone took 56 s of the 60 s budget
  // with every one of them answering. Nothing here waits on a clock of its
  // own, so the budget is what has to fit the frame cost: tripled, as the
  // mount/dispose canary in `leaks.spec.ts` is. The settle after the wheel
  // is frame-bound the same way: a drawn frame advances the camera by at most
  // `MAX_FRAME_DELTA` (50 ms), so a one-second zoom ease takes twenty frames,
  // a minute at 3 s a frame, past the 30 s default of `waitForCameraStill`.
  test.slow();
  await hoverScene(page);
  await page.mouse.down();
  await page.mouse.up();
  // The click lands several slow frames later: wait for the focus it gives.
  await page.waitForFunction(() => document.querySelector('[data-jeex="viewer"]')?.matches(':focus-within') === true);
  // A click on a surface in 360 opens its finish panel right under the
  // pointer; close it (focus stays in the viewer) so the wheel meets the scene.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-jeex="viewer"]')?.matches(':focus-within') === true);
  await waitForCameraStill(page);
  const before = await camera(page);
  const top = await scrollY(page);
  await page.mouse.wheel(0, -240);
  await expectCameraMoved(page, before, 0.1);
  await page.keyboard.press('Space');
  await page.mouse.wheel(0, 120);
  await waitForCameraStill(page, undefined, SETTLE_AFTER_WHEEL_MS);
  expect(await scrollY(page)).toBe(top);
  expect(await page.evaluate(() => window.__plateShown)).toBe(false);
});

declare global {
  interface Window {
    /** Set by `watchPlate` the moment the «Ctrl + scroll» plate goes up. */
    __plateShown?: boolean;
  }
}
