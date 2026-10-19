/**
 * `overlay: 'unbranded'`: the MLS-feed link, proven against
 * the strictest portal checklist surveyed (Idealista) — no brand lockup, no
 * status pill, no mode switcher, no autoplay before input — on the two
 * viewports the checklist names: 360×640 (a portal's embedded frame) and
 * 1280×720 (the agency's own site).
 */

import { expect, test, type Page } from '@playwright/test';
import { expectCanvasScreenshot, expectChromeScreenshot, expectNoNewA11yViolations, viewerRoot, waitForBoot } from './support.js';

/** WCAG 2.2 §2.5.8 minimum target size, CSS px — same floor as `target-sizes.test.ts`. */
const MIN_TARGET_PX = 24;

/** Measured against the demo apartment: 0 critical/serious findings. */
const A11Y_BUDGET = 0;

async function gotoUnbranded(page: Page): Promise<void> {
  await page.goto('/?unbranded=1');
  await waitForBoot(page, 'window.__appReady === true');
}

/**
 * Two runs of `unbranded.spec.ts`, one per viewport the portal checklist
 * names. `test.describe.configure({ mode: 'serial' })` is NOT needed —
 * `fullyParallel` already isolates the page per test — but `test.use` scopes
 * the viewport override to this one describe block rather than the whole
 * `chromium` project.
 */
for (const viewport of [
  { name: '360x640', width: 360, height: 640 },
  { name: '1280x720', width: 1280, height: 720 },
]) {
  test.describe(`portal checklist at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('no brand lockup, status pill, mode switcher or hint; the control bar stays', async ({ page }) => {
      await gotoUnbranded(page);
      const root = viewerRoot(page);
      await expect(root).toHaveAttribute('data-overlay', 'unbranded');
      await expect(page.locator('[data-jeex="brand-lockup"]')).toBeHidden();
      await expect(page.locator('[data-jeex="mode-switcher"]')).toBeHidden();
      await expect(page.locator('[data-jeex="tour-status"]')).toBeHidden();
      await expect(page.locator('[data-jeex="hint-card"]')).toBeHidden();
      await expect(page.locator('[data-jeex="control-bar"]')).toBeVisible();
    });

    test('an explicit overlay= still wins over the flag', async ({ page }) => {
      await page.goto('/?unbranded=1&overlay=kiosk');
      await waitForBoot(page, 'window.__appReady === true');
      // kiosk hides the control bar too; unbranded on its own never does.
      await expect(page.locator('[data-jeex="control-bar"]')).toBeHidden();
    });

    test('the canvas does not move on its own for 3 s without input', async ({ page }) => {
      await gotoUnbranded(page);
      const canvas = page.locator('[data-jeex="scene-canvas"]');
      // Two captures of the same element, 3 s apart, against the SAME
      // committed baseline: if the tour (or anything else) had started
      // moving the camera on its own, the second capture would drift outside
      // `CANVAS_DIFF_RATIO` of the first while the first still matches.
      await expectCanvasScreenshot(canvas, `unbranded-canvas-${viewport.name}.png`);
      await page.waitForTimeout(3_000);
      await expectCanvasScreenshot(canvas, `unbranded-canvas-${viewport.name}.png`);
    });

    test('every visible control-bar target is >= 24 x 24 CSS px', async ({ page }) => {
      await gotoUnbranded(page);
      // `:visible` (Playwright's own pseudo-class): the mode-switcher's
      // buttons are still `<button>` nodes under the control bar, `hidden`
      // by `chrome.modeSwitcher: false` — a target that is not on screen at
      // all has no size to fail this check with.
      const targets = page.locator('[data-jeex="control-bar"] button:visible, [data-jeex="control-bar"] [role="button"]:visible');
      // Measured in ONE in-page pass, not per target: every protocol call
      // waits behind a rendered frame, and on a software rasteriser at 1-2 fps
      // (a machine without a usable GPU) a `count` plus `boundingBox` and two
      // `getAttribute` calls per target ran past the 60 s test budget under
      // gate load. `getBoundingClientRect` is what `boundingBox` reports for
      // an element of the main frame, transforms included.
      const measured = await targets.evaluateAll((elements: HTMLElement[]) =>
        elements.map((element, i) => {
          const rect = element.getBoundingClientRect();
          const name = element.getAttribute('aria-label') ?? element.dataset['mode'] ?? `#${i}`;
          return { name, width: rect.width, height: rect.height };
        }),
      );
      expect(measured.length).toBeGreaterThan(0);
      const undersized = measured
        .filter(({ width, height }) => width < MIN_TARGET_PX || height < MIN_TARGET_PX)
        .map(({ name, width, height }) => `${name} ${width}x${height}`);
      expect(undersized).toEqual([]);
    });

    test('the chrome looks as it did', async ({ page }) => {
      await gotoUnbranded(page);
      await expectChromeScreenshot(page, `unbranded-chrome-${viewport.name}.png`);
    });

    test('accessibility: no new critical or serious violations', async ({ page }, testInfo) => {
      await gotoUnbranded(page);
      await expectNoNewA11yViolations(page, testInfo, A11Y_BUDGET);
    });
  });
}
