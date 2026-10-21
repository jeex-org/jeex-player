/**
 * The demo page: does it boot, do the five modes switch, and is the chrome
 * what it was.
 */

import { expect, test } from '@playwright/test';
import {
  expectCanvasScreenshot,
  expectChromeScreenshot,
  expectNoNewA11yViolations,
  modeButton,
  pressMode,
  sceneChildren,
  viewerRoot,
  waitForBoot,
} from './support.js';

/** Critical + serious axe findings on the demo page: none remain. */
const A11Y_BUDGET = 0;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page, 'window.__appReady === true');
});

test('boots into orbit with the apartment on screen and the chrome revealed', async ({ page }) => {
  const root = viewerRoot(page);
  await expect(root).toBeVisible();
  await expect(page.locator('[data-jeex="loading-state"]')).toBeHidden();
  await expect(page.locator('[data-jeex="viewer-ui"]')).toBeVisible();
  await expect(page.locator('[data-jeex="error-state"]')).toBeHidden();
  await expect(modeButton(root, 'orbit')).toHaveAttribute('aria-pressed', 'true');
  // The brand context line is filled from `scene.name` at document time, never
  // baked into the viewer.
  await expect(page.locator('[data-jeex="brand-context"]')).not.toBeEmpty();
  // The apartment is BUILT: the scene root carries the shell, the openings
  // and the furniture the builder made for this document.
  expect((await sceneChildren(page)).length).toBeGreaterThan(0);
});

test('the five modes switch, and exactly one button is pressed at a time', async ({ page }) => {
  const root = viewerRoot(page);
  // Five mode switches, each a camera flight or a plan build, are five tests'
  // worth of frames: 2.2 min on four hardware threads without a GPU against
  // the 3 min a scaled single-test budget gives a hosted runner, which is
  // slower than those threads.
  test.slow();
  // The pressed buttons and the viewer's own mode are read in ONE in-page pass
  // per step: on a software rasteriser every protocol call waits behind a
  // rendered frame, and one assertion per reading ran past the budget.
  const reading = async (): Promise<{ pressed: string[]; mode: string | undefined }> =>
    root.evaluate((viewer) => ({
      pressed: [...viewer.querySelectorAll<HTMLElement>('[data-jeex="control-bar"] [data-mode][aria-pressed="true"]')].map(
        (button) => button.dataset['mode'] ?? '',
      ),
      mode: window.__viewerDebug?.mode(),
    }));
  for (const mode of ['plan2d', 'plan3d', 'orbit', 'walk', 'tour']) {
    await pressMode(root, mode);
    await expect.poll(reading).toEqual({ pressed: [mode], mode });
  }
});

test('each mode shows its own hint', async ({ page }) => {
  const root = viewerRoot(page);
  const hint = page.locator('[data-jeex="hint-text"]');
  await expect(hint).not.toBeEmpty();
  const orbit = await hint.textContent();
  await pressMode(root, 'walk');
  await expect(hint).not.toHaveText(orbit ?? '');
  await expect(hint).not.toBeEmpty();
});

test('the plan mode paints the drawing and stops the renderer', async ({ page }) => {
  const root = viewerRoot(page);
  await pressMode(root, 'plan2d');
  const plan = page.locator('[data-jeex="plan-canvas"]');
  await expect(plan).toHaveAttribute('data-visible', 'true');
  await expect(plan).toHaveAttribute('data-view', 'plan2d');
  await pressMode(root, 'orbit');
  await expect(plan).toHaveAttribute('data-visible', 'false');
});

test('plan2d shows room labels, facade dimensions and the camera marker', async ({ page }) => {
  // Besides walls, openings and doors, plan2d draws what
  // `plan.labels`/`plan.dimensions`/`plan.camera` (all default true) add: a
  // name and area per room, a dimension chain per facade run, and the
  // presentation camera's own marker.
  const root = viewerRoot(page);
  await pressMode(root, 'plan2d');
  const plan = page.locator('[data-jeex="plan-canvas"]');
  await expect(plan).toHaveAttribute('data-visible', 'true');
  await expectCanvasScreenshot(plan, 'index-plan2d.png');
});

test('the mini-map is on screen in walk and gone in orbit', async ({ page }) => {
  const root = viewerRoot(page);
  const minimap = page.locator('[data-jeex="minimap"]');
  await expect(minimap).toHaveAttribute('data-visible', 'false');
  await pressMode(root, 'walk');
  await expect(minimap).toHaveAttribute('data-visible', 'true');
  await pressMode(root, 'orbit');
  await expect(minimap).toHaveAttribute('data-visible', 'false');
});

test('the chrome looks as it did', async ({ page }) => {
  // Woken first, so the baseline is of the bar and not of the reveal pill it
  // collapses to after 4.2 s of idle.
  await viewerRoot(page).hover({ position: { x: 10, y: 10 } });
  await expectChromeScreenshot(page, 'index-chrome.png');
});

test('the apartment is still being rendered', async ({ page }) => {
  await expectCanvasScreenshot(page.locator('[data-jeex="scene-canvas"]'), 'index-canvas.png');
});

test('accessibility: no new critical or serious violations', async ({ page }, testInfo) => {
  await expectNoNewA11yViolations(page, testInfo, A11Y_BUDGET);
});

declare global {
  interface Window {
    __appReady?: boolean;
  }
}
