/**
 * The settings panel on real pages: the demo page (light DOM, the settings
 * button on) with the panel open, on the bar's end and, by `?settingsSide=start`,
 * on its start; and a second `<jeex-viewer settings settings-side="start">` on
 * the element page (inside a shadow root). Each with no accessibility finding.
 * Presses are keyboard activation or an evaluated DOM click, never a
 * Playwright pointer click: a live viewer on the software rasteriser keeps the
 * page busy every frame and pointer actions stall over it. The visibility and
 * in-viewer geometry checks stay, so a dispatched press cannot hide an
 * unreachable button.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoNewA11yViolations, waitForBoot, waitForChromeIdle } from './support.js';

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect!;
}

/**
 * Brings the control bar back the way a keyboard user does: the bar has
 * collapsed on its idle timer (and is `inert`, so its buttons take no focus),
 * the reveal control takes the focus and Enter. A focus inside the viewer
 * keeps the bar awake while it stays there, so the settings button can be
 * focused next. Every machine takes this path: the specs wait for the
 * collapse first instead of racing the 4.2 s timer against the boot.
 */
async function revealBarByKeyboard(page: Page): Promise<void> {
  await waitForChromeIdle(page);
  await page.locator('[data-jeex="reveal-controls"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-jeex="control-bar"]')).toHaveAttribute('data-collapsed', 'false');
}

/** The plate attached to the bar's start (beside it, or under it in a narrow viewer) and inside the viewer. */
async function expectOnStart(viewer: Locator): Promise<void> {
  const bar = await box(viewer.locator('[data-jeex="control-bar"]'));
  const plate = await box(viewer.locator('[data-jeex="settings-extension"]'));
  const frame = await box(viewer.locator('.jeex-viewer').first());
  expect(plate.x).toBeGreaterThanOrEqual(frame.x);
  expect(plate.x + plate.width).toBeLessThanOrEqual(frame.x + frame.width);
  const beside = plate.x + plate.width <= bar.x;
  const under = Math.abs(plate.x - bar.x) < 1.5 && plate.y >= bar.y + bar.height;
  expect(beside || under).toBe(true);
}

test('demo page: the panel opens by keyboard, steps the temperature, closes on Escape, and axe finds nothing', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await waitForBoot(page, 'window.__appReady === true');
  await revealBarByKeyboard(page);
  const button = page.locator('[data-jeex="settings-button"]');
  await expect(button).toBeVisible();
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  const panel = page.locator('[data-jeex="settings-panel"]');
  await expect(panel).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const slider = panel.locator('input[type="range"]');
  await expect(slider).toBeFocused();
  await expect(slider).toHaveAttribute('aria-valuetext', 'Original');
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuetext', '3900 K · neutral');
  expect(await page.evaluate(() => window.jeexViewer?.getState().lightTemperature)).toBe(3900);
  await expectNoNewA11yViolations(page, testInfo, 0);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
});

test("demo page with `?settingsSide=start`: the button on the bar's start, opened by keyboard, and axe finds nothing", async ({
  page,
}, testInfo) => {
  await page.goto('/?settingsSide=start');
  await waitForBoot(page, 'window.__appReady === true');
  await revealBarByKeyboard(page);
  const button = page.locator('[data-jeex="settings-button"]');
  await expect(button).toBeVisible();
  await expectOnStart(page.locator('body'));
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  const panel = page.locator('[data-jeex="settings-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('input[type="range"]')).toBeFocused();
  const opened = await box(panel);
  const plate = await box(page.locator('[data-jeex="settings-extension"]'));
  // The popover's start edge under the plate's, not pushed out of the viewer.
  expect(opened.x).toBeGreaterThanOrEqual(0);
  expect(opened.x).toBeLessThanOrEqual(plate.x + plate.width);
  await expectNoNewA11yViolations(page, testInfo, 0);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
});

test('element page: a second viewer with `settings` and `settings-side="start"` in a shadow root, independent of the first, and axe finds nothing', async ({
  page,
}, testInfo) => {
  await page.goto('/dev/embed-element.html');
  await waitForBoot(page, 'window.__appReady === true');
  await page.evaluate(() => {
    const first = document.querySelector('#viewer')!;
    const second = document.createElement('jeex-viewer');
    for (const name of ['view', 'tour', 'lang', 'readonly', 'analytics', 'src']) {
      const value = first.getAttribute(name);
      if (value !== null) second.setAttribute(name, value);
    }
    second.id = 'second';
    second.setAttribute('settings', '');
    second.setAttribute('settings-side', 'start');
    second.setAttribute('loading', 'eager');
    second.setAttribute('light-temperature', '3000');
    first.after(second);
  });
  const second = page.locator('#second');
  const button = second.locator('[data-jeex="settings-button"]');
  await expect(button).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#viewer [data-jeex="settings-button"]')).toHaveCount(0);
  await expectOnStart(second);
  await button.evaluate((element: HTMLElement) => element.click());
  const panel = second.locator('[data-jeex="settings-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('output')).toHaveText('3000 K · warm');
  await expectNoNewA11yViolations(page, testInfo, 0);
  // A live attribute change reaches the open panel; the first viewer stays at «Original».
  await page.evaluate(() => document.querySelector('#second')!.setAttribute('light-temperature', '6500'));
  await expect(panel.locator('output')).toHaveText('6500 K · cool');
  const states = await page.evaluate(() => {
    type El = HTMLElement & { viewer: { getState(): { lightTemperature: number | null } } | null };
    const read = (selector: string): number | null | undefined => document.querySelector<El>(selector)?.viewer?.getState().lightTemperature;
    return [read('#viewer'), read('#second')];
  });
  expect(states).toEqual([null, 6500]);
});
