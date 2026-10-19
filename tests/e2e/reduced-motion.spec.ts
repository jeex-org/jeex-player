/**
 * `prefers-reduced-motion: reduce` downgrades an engaged tour
 * to paused and makes scripted camera travel land in one frame.
 *
 * `page.emulateMedia` is set BEFORE `page.goto`, because `resolveViewerOptions`
 * reads the media query once, at mount — a page already loaded would not
 * retroactively see it (that half is `viewer-app.ts`'s live listener, not
 * this page's boot).
 */

import { expect, test, type Page } from '@playwright/test';
import { DEMO } from '../../src/demo/demo-ids.js';
import { waitForBoot } from './support.js';

async function cameraPosition(page: Page): Promise<{ x: number; y: number; z: number } | null> {
  return page.evaluate(() => window.__viewerDebug?.camera() ?? null);
}

test.describe('reduced motion (motion: auto, the default)', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('an engaged tour (view=tour) starts paused instead of playing', async ({ page }) => {
    await page.goto('/?view=tour');
    await waitForBoot(page, 'window.__appReady === true');
    await expect(page.locator('[data-jeex="tour-status"]')).toHaveAttribute('data-state', 'paused');
  });

  test('focusRoom lands the camera within one frame, not over the ~1 s fly-in', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page, 'window.__appReady === true');
    const before = await cameraPosition(page);
    await page.evaluate((room) => window.jeexViewer?.focusRoom(room), DEMO.room.living);
    // One frame is enough for the pose to already equal what the SECOND frame
    // reports too: an animated fly-to would still be moving well past this.
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    });
    const afterOneFrame = await cameraPosition(page);
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    });
    const afterTwoFrames = await cameraPosition(page);
    expect(before).not.toBeNull();
    expect(afterOneFrame).not.toBeNull();
    expect(afterTwoFrames).not.toBeNull();
    expect(afterOneFrame).not.toEqual(before);
    const drift = Math.hypot(
      afterTwoFrames!.x - afterOneFrame!.x,
      afterTwoFrames!.y - afterOneFrame!.y,
      afterTwoFrames!.z - afterOneFrame!.z,
    );
    expect(drift).toBeLessThan(1e-3);
  });
});

test.describe('motion: full overrides a reduced-motion environment', () => {
  test('an engaged tour still starts playing when the host forces full motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?view=tour&motion=full');
    await waitForBoot(page, 'window.__appReady === true');
    await expect(page.locator('[data-jeex="tour-status"]')).toHaveAttribute('data-state', 'playing');
  });
});

test.describe('motion: reduced forces the downgrade with no OS preference at all', () => {
  test('an engaged tour starts paused even without emulating reduced motion', async ({ page }) => {
    await page.goto('/?view=tour&motion=reduced');
    await waitForBoot(page, 'window.__appReady === true');
    await expect(page.locator('[data-jeex="tour-status"]')).toHaveAttribute('data-state', 'paused');
  });
});
