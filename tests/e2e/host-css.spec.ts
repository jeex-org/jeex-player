/**
 * The chrome against a host page's own global CSS, on the light-DOM path.
 *
 * `mountViewer` builds the viewer inside the host's document, so every
 * stylesheet of that page applies to the chrome's buttons, text and icons.
 * `dev/host-css.html` carries a deliberately aggressive, unlayered sheet
 * (`#host-hostile`: a universal reset, body typography, element rules for
 * buttons, inputs, links, icons and images, a theme class on the wrapper).
 *
 * Each test takes the chrome in one state and compares it with the sheet ON
 * and OFF on the SAME page: no second boot, no second scene, so the only thing
 * that can differ is what the host's CSS did. Two comparisons:
 *
 * - geometry and the computed values that make the look, element by element,
 *   read in ONE synchronous pass per state (no timer can fire in between);
 * - the pixels of the viewer box with the scene canvas masked, at the chrome
 *   tolerance of every other chrome baseline (`CHROME_DIFF_RATIO`).
 */

import { expect, test, type Page } from '@playwright/test';
import { CHROME_DIFF_RATIO, holdFrames, viewerRoot, waitForBoot } from './support.js';
import { scaled } from './time-scale.js';

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

/** The computed properties a host sheet most often changes, and that make the chrome look like itself. */
const PROPERTIES = [
  'display',
  'box-sizing',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-align',
  'color',
  'background-color',
  'border-top-width',
  'border-top-color',
  'border-top-left-radius',
  'padding-top',
  'padding-left',
  'margin-top',
  'margin-left',
  'min-height',
  'min-width',
  'box-shadow',
  'outline-style',
  'outline-width',
  'outline-color',
  'outline-offset',
  'appearance',
] as const;

/**
 * Opens the interior-style popover and puts the two transient plates on
 * screen: the degraded-asset notice (shown by a scene with a failed asset)
 * and the reveal pill (shown when the bar collapses). Their classes are set
 * directly: what is compared here is how they are STYLED, and the demo scene
 * has neither a failed asset nor, with `chrome.autoHide: false`, an idle bar.
 */
async function stageChrome(page: Page): Promise<void> {
  await page.locator('[data-jeex="interiors-button"]').evaluate((button: HTMLButtonElement) => button.click());
  const panel = page.locator('[data-jeex="finish-panel"]');
  await expect(panel).toHaveAttribute('data-kind', 'interior');
  await expect(panel.locator('.finish-swatch').first()).toBeVisible();
  await page.evaluate(async () => {
    document.querySelector('[data-jeex="degraded-notice"]')?.classList.remove('is-hidden');
    document.querySelector('[data-jeex="reveal-controls"]')?.classList.add('is-visible');
    await Promise.all(
      [...document.querySelectorAll('.jeex-viewer img')].map((image) => (image as HTMLImageElement).decode().catch(() => {})),
    );
  });
}

type Reading = Record<string, string>;

/**
 * Every rendered element of the chrome, keyed by its path from the root: its
 * box (to the half pixel) and `PROPERTIES`, once with the host sheet enabled
 * and once disabled, inside one task.
 */
async function readBothStates(page: Page): Promise<{ hostile: Reading; clean: Reading }> {
  return page.evaluate((properties) => {
    const sheet = document.querySelector<HTMLStyleElement>('#host-hostile');
    const root = document.querySelector<HTMLElement>('[data-jeex="viewer"]');
    if (!sheet || !root) throw new Error('host-css: no hostile sheet or no viewer');
    const half = (value: number): number => Math.round(value * 2) / 2;
    const read = (): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (element: Element, path: string): void => {
        // The scene canvas is the renderer's, and a slot box is the host's own territory: what
        // the host's CSS does to its slotted content is the host's business (README, «Host slots»).
        if (element.matches('canvas, [data-jeex-slot]')) return;
        const style = getComputedStyle(element);
        if (style.display === 'none') return;
        const box = element.getBoundingClientRect();
        const rect = `${half(box.x)},${half(box.y)} ${half(box.width)}x${half(box.height)}`;
        // The root's own inherited values are the host's: it is the element a host sizes and
        // themes, and the chrome below it must not depend on them. Its box must not move.
        out[path] = element === root ? rect : [rect, ...properties.map((name) => `${name}=${style.getPropertyValue(name)}`)].join(' | ');
        [...element.children].forEach((child, index) =>
          walk(child, `${path}>${(child as HTMLElement).dataset['jeex'] ?? child.tagName.toLowerCase()}[${index}]`),
        );
      };
      walk(root, 'viewer');
      return out;
    };
    sheet.disabled = false;
    const hostile = read();
    sheet.disabled = true;
    const clean = read();
    sheet.disabled = false;
    return { hostile, clean };
  }, PROPERTIES);
}

/**
 * The viewer box as PNG bytes, with the scene canvas left unpainted
 * (`stillChrome`). Not Playwright's `mask`: it paints an overlay over the
 * canvas's whole box, and the canvas fills the viewer, so the overlay would
 * cover the very chrome being compared.
 */
async function shot(page: Page): Promise<Buffer> {
  return viewerRoot(page).screenshot({ animations: 'disabled', caret: 'hide', timeout: scaled(40_000) });
}

/**
 * Makes the chrome hold still for a comparison: no transition or animation
 * (a colour transition would still show the previous state right after the
 * host sheet flips), and the scene canvas keeps its box but paints nothing,
 * so the backdrop behind it is the same flat colour in every shot. The same
 * in both states, so it cannot hide a difference the host's CSS made.
 */
async function stillChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    const still = document.createElement('style');
    still.textContent =
      '.jeex-viewer *, .jeex-viewer *::before, .jeex-viewer *::after { transition: none !important; animation: none !important; }';
    document.head.append(still);
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.jeex-viewer canvas')) canvas.style.visibility = 'hidden';
  });
}

/** Share of pixels whose channels differ by more than a font-rasterisation step, decoded in the page. */
async function diffRatio(page: Page, a: Buffer, b: Buffer): Promise<{ ratio: number; size: string }> {
  return page.evaluate(
    async ([left, right]) => {
      const decode = async (base64: string): Promise<ImageData> => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('host-css: no 2d context');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [x, y] = await Promise.all([decode(left), decode(right)]);
      if (x.width !== y.width || x.height !== y.height) return { ratio: 1, size: `${x.width}x${x.height} vs ${y.width}x${y.height}` };
      let differing = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const delta = Math.max(
          Math.abs(x.data[i]! - y.data[i]!),
          Math.abs(x.data[i + 1]! - y.data[i + 1]!),
          Math.abs(x.data[i + 2]! - y.data[i + 2]!),
        );
        if (delta > 24) differing += 1;
      }
      return { ratio: differing / (x.width * x.height), size: `${x.width}x${x.height}` };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page }) => {
      await page.goto('/dev/host-css.html');
      await waitForBoot(page, 'window.__appReady === true');
      await stageChrome(page);
      await holdFrames(page);
      await stillChrome(page);
    });

    test('the host sheet changes no box and no computed style of the chrome', async ({ page }) => {
      const { hostile, clean } = await readBothStates(page);
      expect(Object.keys(clean).length, 'the chrome was read at all').toBeGreaterThan(40);
      expect(hostile).toEqual(clean);
    });

    test('hover and keyboard focus look the same with and without the host sheet', async ({ page }) => {
      // The host sheet has `button:hover`, `button:focus` and an outline on every button.
      const hovered = page.locator('[data-jeex="control-bar"] [data-mode="walk"]');
      const box = await hovered.boundingBox();
      if (!box) throw new Error('host-css: the walk button has no box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.locator('[data-jeex="reset-button"]').evaluate((button: HTMLButtonElement) => button.focus({ focusVisible: true }));
      const { hostile, clean } = await readBothStates(page);
      expect(hostile).toEqual(clean);
    });

    test('the chrome looks the same with and without the host sheet', async ({ page }) => {
      const sheet = page.locator('#host-hostile');
      const withHostile = await shot(page);
      await sheet.evaluate((element: HTMLStyleElement) => (element.disabled = true));
      const withoutHostile = await shot(page);
      const { ratio, size } = await diffRatio(page, withHostile, withoutHostile);
      await test.info().attach('hostile.png', { body: withHostile, contentType: 'image/png' });
      await test.info().attach('clean.png', { body: withoutHostile, contentType: 'image/png' });
      expect(ratio, `differing pixels in the ${size} viewer box`).toBeLessThanOrEqual(CHROME_DIFF_RATIO);
    });
  });
}
