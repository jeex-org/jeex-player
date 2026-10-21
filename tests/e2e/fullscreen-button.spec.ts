/**
 * The standalone fullscreen button and read-only mode: a page with
 * `controls=0&fullscreenButton=1&readonly=1` shows only the floating button,
 * 32/32 px from the top-right corner; entering fullscreen hides it and shows
 * the control bar without the brand and Interior styles (Reset camera stays);
 * leaving fullscreen restores the first state.
 */

import { expect, test, type Page } from '@playwright/test';
import { viewerRoot, waitForBoot } from './support.js';
import { scaled } from './time-scale.js';

/** The nodes this spec reads, by shell name. */
const NAMES = [
  'fullscreen-float',
  'control-bar',
  'brand-lockup',
  'reset-button',
  'interiors-button',
  'mode-switcher',
  'furniture-button',
  'fullscreen-button',
] as const;

/**
 * Every node's visibility (its own `hidden` or an ancestor's, i.e. no layout
 * box) plus whether the document is fullscreen, read in ONE in-page pass: on a
 * software rasteriser every protocol call waits behind a rendered frame, and
 * one assertion per node ran past the 60 s budget (`unbranded.spec.ts` gives
 * the same reason).
 */
async function chromeState(page: Page): Promise<{ fullscreen: boolean; shown: Record<string, boolean> }> {
  return page.evaluate((names) => {
    const shown: Record<string, boolean> = {};
    for (const name of names) {
      const element = document.querySelector<HTMLElement>(`[data-jeex="${name}"]`);
      shown[name] = element !== null && element.getClientRects().length > 0;
    }
    return { fullscreen: document.fullscreenElement !== null, shown };
  }, NAMES);
}

test('controls=0 + fullscreenButton + readonly: floating button, then the read-only bar in fullscreen, then back', async ({ page }) => {
  // A fullscreen viewport is the largest canvas any spec renders; on a
  // software rasteriser under gate load one frame takes seconds.
  test.setTimeout(scaled(120_000));
  await page.goto('/?controls=0&fullscreenButton=1&readonly=1');
  await waitForBoot(page, 'window.__appReady === true');
  const root = viewerRoot(page);

  const before = await chromeState(page);
  expect(before.fullscreen).toBe(false);
  expect(before.shown['fullscreen-float']).toBe(true);
  expect(before.shown['control-bar']).toBe(false);
  const offsets = await root.evaluate((element) => {
    const rootBox = element.getBoundingClientRect();
    const box = element.querySelector('[data-jeex="fullscreen-float"]')!.getBoundingClientRect();
    return {
      right: Math.round(rootBox.right - box.right),
      top: Math.round(box.top - rootBox.top),
    };
  });
  expect(offsets).toEqual({ right: 32, top: 32 });

  // A real key press on the focused button is the user gesture
  // `requestFullscreen` needs, as a real click would be. Not `click()`: its
  // actionability checks wait behind SwiftShader frames, and at this, the
  // largest viewport any spec renders, one click outlasted a 120 s budget on a
  // hosted runner. `press` focuses the button and sends a trusted Enter, which
  // the `<button>` turns into its own click.
  await page.locator('[data-jeex="fullscreen-float"]').press('Enter');
  // Polled as a whole: `fullscreenElement` is set before `fullscreenchange`
  // is dispatched (in the next rendering update), and the chrome follows the
  // event, so on a slow frame the two can be read one frame apart.
  await expect
    .poll(() => chromeState(page), { timeout: scaled(30_000) })
    .toEqual({
      fullscreen: true,
      shown: {
        'fullscreen-float': false,
        'control-bar': true,
        'brand-lockup': false,
        'reset-button': true,
        'interiors-button': false,
        'mode-switcher': true,
        'furniture-button': true,
        'fullscreen-button': true,
      },
    });

  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(
      async () => {
        const { fullscreen, shown } = await chromeState(page);
        return {
          fullscreen,
          float: shown['fullscreen-float'],
          bar: shown['control-bar'],
        };
      },
      { timeout: scaled(30_000) },
    )
    .toEqual({ fullscreen: false, float: true, bar: false });
});

test('the default page offers no floating button and keeps the full bar', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page, 'window.__appReady === true');
  await expect(page.locator('[data-jeex="fullscreen-float"]')).toBeHidden();
  await expect(page.locator('[data-jeex="brand-lockup"]')).toBeVisible();
  await expect(page.locator('[data-jeex="reset-button"]')).toBeVisible();
});

test('the floating button keeps its 44 px touch target in a 390 px viewer', async ({ page }) => {
  // The narrow-width rules shrink the bar's own icon buttons to 30 px; the
  // floating button is not one of them.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?controls=0&fullscreenButton=1');
  await waitForBoot(page, 'window.__appReady === true');
  const box = await page.locator('[data-jeex="fullscreen-float"]').boundingBox();
  expect(box).not.toBeNull();
  expect({ width: Math.round(box!.width), height: Math.round(box!.height) }).toEqual({ width: 44, height: 44 });
});
