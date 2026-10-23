/**
 * The settings panel on real pages: the demo page (light DOM, the settings
 * button on) with the panel open, and a second `<jeex-viewer settings>` on the
 * element page (inside a shadow root), each with no accessibility finding and
 * driven by the keyboard alone.
 */

import { expect, test } from '@playwright/test';
import { expectNoNewA11yViolations, waitForBoot } from './support.js';

test('demo page: the panel opens by keyboard, steps the temperature, closes on Escape, and axe finds nothing', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await waitForBoot(page, 'window.__appReady === true');
  const button = page.locator('[data-jeex="settings-button"]');
  await expect(button).toBeVisible();
  await button.focus();
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

test('element page: a second viewer with `settings` in a shadow root, independent of the first, and axe finds nothing', async ({
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
    second.setAttribute('loading', 'eager');
    second.setAttribute('light-temperature', '3000');
    first.after(second);
  });
  const second = page.locator('#second');
  const button = second.locator('[data-jeex="settings-button"]');
  await expect(button).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#viewer [data-jeex="settings-button"]')).toHaveCount(0);
  await button.click();
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
