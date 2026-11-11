/**
 * The cooperative rule for touch, on a phone-sized page that scrolls: a
 * vertical swipe that starts on a viewer nobody has engaged scrolls the page
 * and leaves the camera alone; after a tap the same swipe turns the camera
 * and the page stays where it was.
 *
 * Real touch input through the Chrome DevTools Protocol
 * (`Input.dispatchTouchEvent`), because what is proved here is the BROWSER's
 * default action (the page scroll), which `touch-action` decides when the
 * finger lands — a synthetic event dispatched to the canvas scrolls nothing.
 */

import { devices, expect, test, type CDPSession, type Page } from '@playwright/test';
import { waitForBoot, waitForCameraStill } from './support.js';
import { scaled } from './time-scale.js';

type Pose = { x: number; y: number; z: number };

const { viewport, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch });

async function camera(page: Page): Promise<Pose> {
  const pose = await page.evaluate(() => window.__viewerDebug?.camera());
  if (!pose) throw new Error('embed-scroll-touch: no camera pose');
  return pose;
}

function moved(a: Pose, b: Pose): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

async function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

/** The middle of the scene canvas, in CSS pixels of the viewport. */
async function sceneCentre(page: Page): Promise<{ x: number; y: number; height: number }> {
  const box = await page.locator('#stage [data-jeex="scene-canvas"]').boundingBox();
  if (!box) throw new Error('embed-scroll-touch: the canvas has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, height: box.height };
}

/** One finger from `from` by `travel` pixels, in small steps, then lifted. */
async function swipe(cdp: CDPSession, from: { x: number; y: number }, travel: { x: number; y: number }): Promise<void> {
  const steps = 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let step = 1; step <= steps; step += 1) {
    const point = { x: from.x + (travel.x * step) / steps, y: from.y + (travel.y * step) / steps, id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/embed-scroll.html');
  // A listing page on a phone: the viewer spans the full width of the screen.
  await page.addStyleTag({ content: 'body { padding: 0 !important; } .stage { border-radius: 0 !important; }' });
  await waitForBoot(page, 'window.__embedScrollReady === true');
  await waitForCameraStill(page);
});

test('a vertical swipe over an untouched viewer scrolls the page and leaves the camera alone', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const root = page.locator('#stage [data-jeex="viewer"]');
  const before = await camera(page);
  const centre = await sceneCentre(page);
  await swipe(cdp, centre, { x: 0, y: -centre.height / 2 });
  await expect.poll(async () => scrollY(page)).toBeGreaterThan(40);
  await waitForCameraStill(page);
  expect(moved(before, await camera(page))).toBeLessThan(1e-3);
  // The swipe was the page's: the viewer is still not engaged.
  await expect(root).toHaveAttribute('data-jeex-engaged', 'false');
});

test('a sideways drag over an untouched viewer still turns the camera, and the page stays put', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const before = await camera(page);
  const centre = await sceneCentre(page);
  await swipe(cdp, { x: centre.x - 120, y: centre.y }, { x: 240, y: 0 });
  await expect.poll(async () => moved(before, await camera(page)), { timeout: scaled(30_000) }).toBeGreaterThan(0.05);
  expect(await scrollY(page)).toBe(0);
});

test('after a tap the viewer owns the finger: the same swipe turns the camera and the page stays put', async ({ page }) => {
  test.slow();
  const cdp = await page.context().newCDPSession(page);
  const focused = (): Promise<unknown> =>
    page.waitForFunction(() => document.querySelector('#stage [data-jeex="viewer"]')?.matches(':focus-within') === true);
  const centre = await sceneCentre(page);
  await page.touchscreen.tap(centre.x, centre.y);
  // The tap lands several slow frames later: wait for the focus it gives.
  await focused();
  // A tap on a surface in 360 opens its finish panel under the finger; close
  // it (focus stays in the viewer) so the swipe meets the scene.
  await page.keyboard.press('Escape');
  await focused();
  await waitForCameraStill(page);
  const before = await camera(page);
  const top = await scrollY(page);
  await swipe(cdp, centre, { x: 0, y: -centre.height / 2 });
  await expect.poll(async () => moved(before, await camera(page)), { timeout: scaled(30_000) }).toBeGreaterThan(0.05);
  expect(await scrollY(page)).toBe(top);
});
