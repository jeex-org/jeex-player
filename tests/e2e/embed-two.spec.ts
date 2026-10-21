/**
 * Two viewers in one page, from one bundle.
 *
 * The page is the executable acceptance test of "the viewer is a component"
 * (`dev/embed-two.ts`); this asserts the three properties it exists to prove —
 * per-instance input, per-instance locale, one owner for the page globals —
 * plus what happens to the survivor when the first is disposed.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectCanvasScreenshot, expectChromeScreenshot, expectNoNewA11yViolations, modeButton, waitForBoot } from './support.js';

/** The color-contrast finding (.stage-label) is fixed. */
const A11Y_BUDGET = 0;

function stage(page: Page, id: 'stage-a' | 'stage-b'): Locator {
  return page.locator(`#${id} [data-jeex="viewer"]`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/embed-two.html');
  await waitForBoot(page, 'window.__embedTwoReady === true');
});

test('both viewers mount, each with its own shell and its own canvas', async ({ page }) => {
  await expect(page.locator('[data-jeex="viewer"]')).toHaveCount(2);
  await expect(stage(page, 'stage-a')).toBeVisible();
  await expect(stage(page, 'stage-b')).toBeVisible();
  await expect(page.locator('[data-jeex="scene-canvas"]')).toHaveCount(2);
  // One stylesheet for both: `ensureViewerStyles` adopts a single constructed
  // sheet per root, and both viewers are in the same document.
  const styleTags = await page.locator('head style').count();
  expect(styleTags).toBeLessThanOrEqual(1);
});

test('the locale is per instance: switching one leaves the other in English', async ({ page }) => {
  // Both mount in English. The button's description is localized; its
  // visible name is `Walk` in both (mode names are never translated).
  const before = await modeButton(stage(page, 'stage-b'), 'walk').getAttribute('title');
  expect((before ?? '').length).toBeGreaterThan(0);
  expect(await modeButton(stage(page, 'stage-a'), 'walk').getAttribute('title')).toBe(before);

  await page.evaluate(() => window.jeexPair?.second.setLocale('de'));

  await expect(modeButton(stage(page, 'stage-b'), 'walk')).not.toHaveAttribute('title', before ?? '');
  await expect(modeButton(stage(page, 'stage-a'), 'walk')).toHaveAttribute('title', before ?? '');
  await expect(modeButton(stage(page, 'stage-b'), 'walk')).toHaveText('Walk');
  expect(await page.evaluate(() => window.jeexPair?.first.getLocale())).toBe('en');
  expect(await page.evaluate(() => window.jeexPair?.second.getLocale())).toBe('de');
});

test('keys go to the viewer that was clicked, and never to the host page’s input', async ({ page }) => {
  const before = await page.evaluate(() => ({
    a: window.jeexPair?.first.getMode(),
    b: window.jeexPair?.second.getMode(),
  }));
  expect(before).toEqual({ a: 'walk', b: 'walk' });

  // The host's own field must keep its keystrokes: the viewer listens on its
  // shell root, not on `window`.
  const input = page.locator('#host-input');
  await input.click();
  await input.pressSequentially('wasd');
  await expect(input).toHaveValue('wasd');

  // A pointerdown on a canvas focuses that viewer's root; that is what makes
  // the keyboard per instance.
  await stage(page, 'stage-a')
    .locator('[data-jeex="scene-canvas"]')
    .click({ position: { x: 40, y: 40 } });
  const focusedIsFirst = await page.evaluate(() => {
    const first = document.querySelector('#stage-a [data-jeex="viewer"]');
    return document.activeElement === first;
  });
  expect(focusedIsFirst).toBe(true);
});

test('disposing the first leaves the second rendering and takes the globals with it', async ({ page }) => {
  // The FIRST viewer claimed the page globals; the second never had them.
  expect(await page.evaluate(() => window.__appReady === true)).toBe(true);

  await page.evaluate(() => window.jeexPair?.disposeFirst());

  await expect.poll(async () => page.evaluate(() => window.__appReady)).toBe(false);
  expect(await page.evaluate(() => window.__viewerDebug === undefined)).toBe(true);

  // The survivor is untouched: still on screen, still answering.
  await expect(stage(page, 'stage-b')).toBeVisible();
  expect(await page.evaluate(() => window.jeexPair?.second.getMode())).toBe('walk');
  await page.evaluate(() => window.jeexPair?.second.setMode('orbit'));
  expect(await page.evaluate(() => window.jeexPair?.second.getMode())).toBe('orbit');
});

test('the chrome of both viewers looks as it did', async ({ page }) => {
  await stage(page, 'stage-a').hover({ position: { x: 10, y: 10 } });
  await stage(page, 'stage-b').hover({ position: { x: 10, y: 10 } });
  await expectChromeScreenshot(page, 'embed-two-chrome.png');
});

test('the second viewer is still rendering its own apartment', async ({ page }) => {
  await expectCanvasScreenshot(stage(page, 'stage-b').locator('[data-jeex="scene-canvas"]'), 'embed-two-canvas.png');
});

test('accessibility: no new critical or serious violations', async ({ page }, testInfo) => {
  await expectNoNewA11yViolations(page, testInfo, A11Y_BUDGET);
});

declare global {
  interface Window {
    __embedTwoReady?: boolean;
    __appReady?: boolean;
  }
}
