/**
 * `<jeex-viewer>` on a host page: a real registry, a real shadow root, real
 * `composed` events reaching a listener on `document`.
 */

import { expect, test } from '@playwright/test';
import { expectCanvasScreenshot, expectChromeScreenshot, expectNoNewA11yViolations, waitForBoot } from './support.js';
import { scaled } from './time-scale.js';

/** The color-contrast finding (#log/#events) is fixed. */
const A11Y_BUDGET = 0;

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/embed-element.html');
  // The element owns the page's only viewer, so the page globals are its.
  await waitForBoot(page, 'window.__appReady === true');
});

test('the viewer lives in the element’s shadow root, invisible to the document', async ({ page }) => {
  const inShadow = await page.evaluate(() => {
    const element = document.querySelector('#viewer');
    return {
      hasShadow: element?.shadowRoot !== null && element?.shadowRoot !== undefined,
      inside: element?.shadowRoot?.querySelector('[data-jeex="viewer"]') !== null,
      documentWide: document.querySelector('[data-jeex="viewer"]') !== null,
      sheets: element?.shadowRoot?.adoptedStyleSheets.length ?? 0,
    };
  });
  expect(inShadow.hasShadow).toBe(true);
  expect(inShadow.inside).toBe(true);
  // The boundary is real; nothing of the viewer's leaks into the host's tree.
  expect(inShadow.documentWide).toBe(false);
  // The component sheet and the element's own `:host` box.
  expect(inShadow.sheets).toBe(2);
});

test('jeex-ready crossed the shadow boundary to a listener on document', async ({ page }) => {
  await expect.poll(async () => page.evaluate(() => window.jeexElement?.events ?? [])).toContain('jeex-ready');
});

test('the view attribute stays live after the mount', async ({ page }) => {
  const mode = async (): Promise<string | undefined> => page.evaluate(() => window.jeexElement?.element.viewer?.getMode());
  expect(await mode()).toBe('orbit');
  await page.locator('#to-walk').click();
  await expect.poll(mode).toBe('walk');
  await expect.poll(async () => page.evaluate(() => window.jeexElement?.events ?? [])).toContain('jeex-mode');
  await page.locator('#to-orbit').click();
  await expect.poll(mode).toBe('orbit');
});

test('a src swap loads the new scene and raises jeex-scene', async ({ page }) => {
  // The FIRST document already raised `jeex-scene` during the boot, so «the
  // log contains jeex-scene» is true before the click and proves nothing; the
  // swap is the NEXT one. Waiting on the mere presence let the name be read
  // before the second document was wired, a race that only a fast renderer
  // lost (first seen on a GPU-rendered run).
  const sceneEvents = async (): Promise<number> =>
    page.evaluate(() => (window.jeexElement?.events ?? []).filter((type) => type === 'jeex-scene').length);
  const before = await sceneEvents();
  expect(before, 'the boot itself raises jeex-scene, which is why presence alone proves nothing').toBeGreaterThan(0);
  await page.locator('#swap-scene').click();
  await expect.poll(sceneEvents, { timeout: scaled(45_000) }).toBeGreaterThan(before);
  // The swapped document differs where the chrome shows it.
  const name = await page.evaluate(
    () => document.querySelector('#viewer')?.shadowRoot?.querySelector('[data-jeex="brand-context"]')?.textContent,
  );
  expect(name).toContain('swapped through src');
});

test('a read-once attribute warns instead of pretending', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.evaluate(() => document.querySelector('#viewer')?.setAttribute('minimap', 'false'));
  await expect.poll(() => warnings.join('\n')).toContain('read once');
});

test('taking the element out of the DOM disposes the viewer and the page globals', async ({ page }) => {
  await page.locator('#remove').click();
  await expect.poll(async () => page.evaluate(() => window.__appReady)).toBe(false);
  expect(await page.evaluate(() => window.__viewerDebug === undefined)).toBe(true);
  expect(await page.evaluate(() => window.jeexElement?.element.viewer)).toBeNull();
  expect(await page.evaluate(() => document.querySelector('#viewer') === null)).toBe(true);
});

test('the chrome looks as it did', async ({ page }) => {
  await page.locator('#viewer').hover({ position: { x: 10, y: 10 } });
  await expectChromeScreenshot(page, 'embed-element-chrome.png');
});

test('the apartment is still being rendered inside the shadow root', async ({ page }) => {
  await expectCanvasScreenshot(page.locator('#viewer [data-jeex="scene-canvas"]'), 'embed-element-canvas.png');
});

test('accessibility: no new critical or serious violations', async ({ page }, testInfo) => {
  await expectNoNewA11yViolations(page, testInfo, A11Y_BUDGET);
});

test('the compound chrome attribute hides every chrome.* flag before the individual attributes apply', async ({ page }) => {
  // A second, TEMPORARY element — `defineJeexViewer` already registered the
  // tag when this page booted — mounted, probed and removed within this one
  // test, so the page's static "chrome looks as it did" screenshot baseline
  // is untouched by it.
  const hidden = await page.evaluate(async () => {
    const src = document.querySelector('#viewer')?.getAttribute('src') ?? '';
    const el = document.createElement('jeex-viewer') as HTMLElement & { shadowRoot: ShadowRoot | null };
    el.setAttribute('src', src);
    el.setAttribute('tour', 'off');
    el.setAttribute('chrome', 'false');
    el.setAttribute('chrome-status', 'true');
    document.body.append(el);
    // The element starts its viewer near the viewport, and it was appended
    // below the page's own player.
    el.scrollIntoView();
    await new Promise<void>((resolve) => {
      el.addEventListener('jeex-ready', () => resolve(), { once: true });
    });
    const root = el.shadowRoot!;
    const isHidden = (name: string): boolean => (root.querySelector(`[data-jeex="${name}"]`) as HTMLElement).hidden === true;
    const result = {
      brand: isHidden('brand-lockup'),
      controls: isHidden('control-bar'),
      hint: isHidden('hint-card'),
      modeSwitcher: isHidden('mode-switcher'),
    };
    el.remove();
    return result;
  });
  expect(hidden).toEqual({ brand: true, controls: true, hint: true, modeSwitcher: true });
});

declare global {
  interface Window {
    __appReady?: boolean;
  }
}
