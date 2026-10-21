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
import { scaled } from './time-scale.js';

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
  await expect.poll(async () => page.evaluate(() => window.jeexEmbed?.events ?? []), { timeout: scaled(30_000) }).toContain('progress');
  await page.locator('#pause').click();
});

/**
 * How long, after the right command was answered, the frame gets to answer
 * the three it must drop. Not a budget but an observation window: the frame
 * handles messages in the order they were posted, and the right one was
 * posted last, so by the time its reply arrives the other three have long been
 * handled; the window only catches a reply that a dropped message would have
 * produced out of order.
 */
const STRAY_REPLY_WINDOW_MS = 1_500;

test('the frame answers only the origin it was given and only this protocol', async ({ page }) => {
  // The page keeps every reply from the frame and resolves once the right
  // command is answered, within a generous (scaled) deadline: on a software
  // rasteriser the frame's main thread is behind several frames, and a fixed
  // 1.5 s wait for the reply ran out on a hosted runner before it arrived.
  const answered = await page.evaluate(
    async ({ deadlineMs, windowMs }) => {
      const iframe = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
      const ids: string[] = [];
      let realAnswered: () => void = () => {};
      const real = new Promise<void>((resolve) => {
        realAnswered = resolve;
      });
      const listener = (event: MessageEvent): void => {
        if (event.source !== iframe.contentWindow) return;
        const id = (event.data as { id?: unknown } | null)?.id;
        if (typeof id !== 'string') return;
        ids.push(id);
        if (id === 'real') realAnswered();
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
      const pause = (ms: number): Promise<void> =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
      await Promise.race([real, pause(deadlineMs)]);
      await pause(windowMs);
      window.removeEventListener('message', listener);
      return ids;
    },
    { deadlineMs: scaled(15_000), windowMs: STRAY_REPLY_WINDOW_MS },
  );
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
  // the collapsed pill. The move itself wakes the bar — it reaches the viewer
  // root — so the pointer is put on the lockup with `force`, without
  // Playwright's hit-target check: at under one frame per second (SwiftShader
  // on a hosted runner) each retry of that check outlasted the idle timer, the
  // bar collapsed under it again, the canvas took the hit, and the hover
  // retried until the test timed out.
  const frame = page.frameLocator('#stage iframe');
  await frame.locator('[data-jeex="brand-lockup"]').hover({ force: true });
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
