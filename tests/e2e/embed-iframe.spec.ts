/**
 * The iframe form with BOTH real sides in one page: `host.ts` on the outside,
 * `frame-bridge.ts` inside `embed.html`, talking over real `postMessage`.
 *
 * This is the one place in the pyramid where that is possible. The component
 * level runs under Vitest's instrumented dev server, where `embed.html` in a
 * nested frame cannot execute the viewer's module graph
 * (`tests/component/frame-bridge.test.ts` says so and tests each side against
 * a real counterparty instead).
 */

import { expect, test } from '@playwright/test';
import { expectCanvasScreenshot, expectChromeScreenshot, expectNoNewA11yViolations, waitForBoot, waitForChromeIdle } from './support.js';

/** The iframe frame-title and color-contrast findings are fixed. */
const A11Y_BUDGET = 0;

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/embed-iframe.html');
  await waitForBoot(page, 'window.jeexEmbed?.ready === true');
});

test('the frame is built with the host origin, the viewer id and the options in its query', async ({ page }) => {
  const src = await page.locator('#stage iframe').getAttribute('src');
  const url = new URL(src!, page.url());
  expect(url.pathname).toBe('/embed.html');
  expect(url.searchParams.get('host')).toBe(new URL(page.url()).origin);
  expect(url.searchParams.get('viewerId')).toBe('dev-frame');
  expect(url.searchParams.get('view')).toBe('tour');
  expect(url.searchParams.get('tour')).toBe('paused');
  await expect(page.locator('#stage iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  await expect(page.locator('#stage iframe')).toHaveAttribute('allow', 'fullscreen');
});

test('the frame really booted the viewer and reported ready to the host', async ({ page }) => {
  await expect.poll(async () => page.evaluate(() => window.jeexEmbed?.events ?? [])).toContain('ready');
  const frame = page.frameLocator('#stage iframe');
  await expect(frame.locator('[data-jeex="viewer"]')).toBeVisible();
  await expect(frame.locator('[data-jeex="error-state"]')).toBeHidden();
});

test('progress round-trips: the host asks and the frame answers with its own position', async ({ page }) => {
  const progress = await page.evaluate(async () => window.jeexEmbed?.embed.progress());
  expect(progress).toBeTruthy();
  const shape = progress as { fraction: number; duration: number; state: string };
  expect(shape.fraction).toBeGreaterThanOrEqual(0);
  expect(shape.fraction).toBeLessThanOrEqual(1);
  expect(shape.duration).toBeGreaterThan(0);
});

test('a command from the host changes the mode inside the frame', async ({ page }) => {
  await page.locator('#walk').click();
  const minimap = page.frameLocator('#stage iframe').locator('[data-jeex="minimap"]');
  await expect(minimap).toHaveAttribute('data-mode', 'walk');
  await expect.poll(async () => page.evaluate(() => window.jeexEmbed?.events ?? [])).toContain('mode');
});

test('play makes the frame push progress events unasked', async ({ page }) => {
  await page.locator('#play').click();
  await expect.poll(async () => page.evaluate(() => window.jeexEmbed?.events ?? []), { timeout: 30_000 }).toContain('progress');
  await page.locator('#pause').click();
});

test('the frame answers only the origin it was given and only this protocol', async ({ page }) => {
  const answered = await page.evaluate(async () => {
    const iframe = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    const replies: unknown[] = [];
    const listener = (event: MessageEvent): void => {
      if (event.source === iframe.contentWindow) replies.push(event.data);
    };
    window.addEventListener('message', listener);
    const envelope = { channel: 'jeex-embed', version: 1, viewerId: 'dev-frame', kind: 'command' } as const;
    // ① at another target origin: never delivered at all.
    iframe.contentWindow?.postMessage({ ...envelope, id: 'wrong-origin', method: 'getMode' }, 'https://elsewhere.example');
    // ② this origin, foreign channel: delivered and dropped.
    iframe.contentWindow?.postMessage(
      { channel: 'not-jeex', version: 1, viewerId: 'dev-frame', kind: 'command', id: 'foreign', method: 'getMode' },
      location.origin,
    );
    // ③ this origin, another viewer's id: delivered and dropped.
    iframe.contentWindow?.postMessage({ ...envelope, viewerId: 'someone-else', id: 'stray', method: 'getMode' }, location.origin);
    // ④ everything right: answered.
    iframe.contentWindow?.postMessage({ ...envelope, id: 'real', method: 'getMode' }, location.origin);
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
    window.removeEventListener('message', listener);
    return replies.filter((reply): reply is { id: string } => typeof (reply as { id?: unknown }).id === 'string').map((reply) => reply.id);
  });
  expect(answered).toContain('real');
  expect(answered).not.toContain('wrong-origin');
  expect(answered).not.toContain('foreign');
  expect(answered).not.toContain('stray');
});

test('dispose tells the frame, then takes the iframe out of the page', async ({ page }) => {
  await page.locator('#dispose').click();
  await expect.poll(async () => page.evaluate(() => window.jeexEmbed?.events ?? [])).toContain('disposed');
  await expect(page.locator('#stage iframe')).toHaveCount(0);
});

test('the host page and the framed chrome look as they did', async ({ page }) => {
  // The pointer RESTS ON the framed control bar (its brand lockup, which has
  // no hover style), so the bar stays open for the whole capture: its idle
  // timer re-arms while the bar is `:hover` (`ViewerChrome.wake`). A pointer
  // parked on the stage only woke it, and the baseline then depended on the
  // frame rate: a fast machine captured two identical frames inside the 4.2 s
  // idle and got the open bar, a software-rendering one at ~3 fps could not and got
  // the collapsed pill. `hover` itself wakes the bar first — the move reaches
  // the viewer root — and retries until the lockup is the hit target.
  const frame = page.frameLocator('#stage iframe');
  await frame.locator('[data-jeex="brand-lockup"]').hover();
  await expect(frame.locator('[data-jeex="control-bar"]')).toHaveAttribute('data-collapsed', 'false');
  await expectChromeScreenshot(page, 'embed-iframe-chrome.png');
});

test('the framed apartment is still being rendered', async ({ page }) => {
  // The baseline is of the resting viewer: the bar collapsed, as nothing here touches it.
  await waitForChromeIdle(page.frameLocator('#stage iframe'));
  await expectCanvasScreenshot(page.frameLocator('#stage iframe').locator('[data-jeex="scene-canvas"]'), 'embed-iframe-canvas.png');
});

test('accessibility: no new critical or serious violations on the host page', async ({ page }, testInfo) => {
  await expectNoNewA11yViolations(page, testInfo, A11Y_BUDGET);
});
