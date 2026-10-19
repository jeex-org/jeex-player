/**
 * The frame page `embed.html` on its own and behind the helper's
 * `autoHeight` — the box it reports, and that a visitor gets no editing.
 */

import { expect, test } from '@playwright/test';

test('the helper sizes the frame to the height embed.html reports for its width and ratio', async ({ page }) => {
  await page.goto('/dev/embed-frame.html');
  const frame = page.locator('#stage iframe');
  await expect.poll(async () => page.evaluate(() => window.jeexFrame?.sizes.at(-1) ?? null)).toEqual({ width: 640, height: 480 });
  await expect.poll(async () => Math.round((await frame.boundingBox())?.height ?? 0)).toBe(480);
  expect(Math.round((await frame.boundingBox())?.width ?? 0)).toBe(640);
});

test('embed.html is read-only for visitors unless its URL opts in with readonly=0', async ({ page }) => {
  const editingControls = async (): Promise<boolean> =>
    page.evaluate(() => {
      const lockup = document.querySelector<HTMLElement>('[data-jeex="brand-lockup"]');
      return lockup !== null && !lockup.hidden;
    });
  await page.goto('/embed.html?tour=off');
  await expect(page.locator('[data-jeex="viewer"]')).toBeVisible();
  await expect.poll(editingControls).toBe(false);
  await page.goto('/embed.html?tour=off&readonly=0');
  await expect(page.locator('[data-jeex="viewer"]')).toBeVisible();
  await expect.poll(editingControls).toBe(true);
});

test('embed.html opts into responsive iframes and its content box follows ?ratio=', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/embed.html?tour=off&ratio=1');
  await expect(page.locator('meta[name="responsive-embedded-sizing"]')).toHaveAttribute('content', 'allow-origins=*');
  const box = await page.locator('#jeex-size').boundingBox();
  expect(Math.round(box?.height ?? 0)).toBe(800);
  // The viewer fills the frame, not the content box.
  const app = await page.locator('#app').boundingBox();
  expect(Math.round(app?.height ?? 0)).toBe(600);
});
