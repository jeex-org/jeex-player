/**
 * "Replace with another…" end to end, at phone size, in the custom element's
 * shadow root, over the offers fixture (`tests/fixtures/offers/`): an offers
 * sofa with twenty variants and two on-surface objects.
 *
 * 1. The Replace panel stays inside a 390 x 700 viewer and its last variant
 *    can be scrolled to and picked.
 * 2. The popup opens from the keyboard, keeps Tab inside, and a pick
 *    replaces the sofa: the new body appears under the same placement id.
 */

import { expect, test, type Page } from '@playwright/test';
import { waitForBoot, waitForProjectionSettled } from './support.js';
import { OFFERS_FIXTURE as OFFERS } from '../fixtures/offers/fixture-ids.js';

test.use({ viewport: { width: 390, height: 700 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/offers.html');
  await waitForBoot(page, 'window.__appReady === true');
  await waitForProjectionSettled(page);
});

/** Clicks the sofa with the real mouse until its Replace panel opens. */
async function openSofaPanel(page: Page): Promise<void> {
  const panel = page.locator('[data-jeex="finish-panel"]');
  for (const height of [0.45, 0.3, 0.6, 0.2]) {
    const point = await page.evaluate((y) => window.__viewerDebug!.projectPoint(2, y, 4.2), height);
    if (!point) continue;
    await page.mouse.click(point.x, point.y);
    // The pick lands on the next frame or two.
    try {
      await expect(panel).toHaveAttribute('data-kind', 'furniture', { timeout: 2000 });
      return;
    } catch {
      // Missed: the next height.
    }
  }
  throw new Error('no click opened the sofa Replace panel');
}

/** The element that has focus, through the shadow root. */
async function focusedInside(page: Page, name: string): Promise<boolean> {
  return page.evaluate((shellName) => {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active?.closest(`[data-jeex="${shellName}"]`) !== null && active !== null;
  }, name);
}

test('every variant is reachable on a phone, and a keyboard pick replaces the sofa under its own id', async ({ page }) => {
  await openSofaPanel(page);
  const panel = page.locator('[data-jeex="finish-panel"]');
  const swatches = panel.locator('[data-variant]');
  await expect(swatches).toHaveCount(20);

  const viewer = (await page.locator('[data-jeex="viewer"]').boundingBox())!;
  const box = (await panel.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewer.y + viewer.height + 0.5);

  const last = swatches.nth(19);
  await last.scrollIntoViewIfNeeded();
  await last.click();
  const lastVariant = OFFERS.variant.longSofa[19];
  await expect.poll(() => page.evaluate((id) => window.__viewerDebug!.assetVariant(id), OFFERS.placement.sofa)).toBe(lastVariant);

  // The popup, from the keyboard.
  await page.locator('[data-jeex="finish-other"]').focus();
  await page.keyboard.press('Enter');
  const popup = page.locator('[data-jeex="replace-popup"]');
  await expect(page.locator('[data-jeex="replace-popup-title"]')).toBeVisible();
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    expect(await focusedInside(page, 'replace-popup')).toBe(true);
  }
  const bench = popup.locator(`[data-offer="${OFFERS.asset.hallBench}"]`);
  await bench.focus();
  await page.keyboard.press('Enter');
  await expect(popup).toBeHidden();

  await expect
    .poll(() =>
      page.evaluate((id) => {
        const element = document.querySelector('#viewer') as unknown as {
          viewer?: { getScene(): { assets: { id: string; asset?: string }[] } | null };
        };
        return element.viewer?.getScene()?.assets.find((asset) => asset.id === id)?.asset ?? null;
      }, OFFERS.placement.sofa),
    )
    .toBe(OFFERS.asset.hallBench);
  await expect
    .poll(() => page.evaluate((id) => window.__viewerDebug!.assetModels().filter((model) => model.id === id).length, OFFERS.placement.sofa))
    .toBe(1);
});
