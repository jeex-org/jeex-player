/**
 * The BUILT custom element (`dist-lib/`, from `bun run build:lib`) below the
 * fold: until the visitor scrolls near it, the page downloads only the
 * element's own static graph — no viewer chunk, no three.js — and creates no
 * WebGL context; the box the element holds is already the player's final
 * size, so the start shifts no layout.
 *
 * Every request is answered by routing, on two invented origins, like
 * `embed-ktx2.spec.ts`: the host page on `HOST`, the library and the project
 * on `CDN`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist-lib');
const HOST = 'https://host.jeex.test';
const CDN = 'https://cdn.jeex.test';
const LIB = `${CDN}/jeex/v1/`;
const PROJECT = `${CDN}/p/flat/project.json`;
/** How long the started player may take to report ready. */
const READY_TIMEOUT_MS = 60_000;

const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
};

/** A host page: an article `articlePx` tall, then the pasted player. */
const hostPage = (articlePx: number, loading = ''): string => `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="module" src="${LIB}jeex-viewer-element.js"></script>
<style>body{margin:0;font:16px system-ui}main{max-width:900px;margin:0 auto;padding:16px}.article{height:${articlePx}px}</style>
<main><h1>Listing</h1><div class="article">Text</div><jeex-viewer id="player" src="${PROJECT}" ratio="16:9"${loading}></jeex-viewer><p>Footer</p></main>`;
/** Far below the fold, out of reach of the start margin. */
const BELOW_THE_FOLD = hostPage(2400);
/** At the top: the player starts on the first layout, as every player did before. */
const ABOVE_THE_FOLD = hostPage(0);
/** Far below the fold, but `loading="eager"`: the host wants the player now. */
const EAGER_BELOW_THE_FOLD = hostPage(2400, ' loading="eager"');

/** Serves the page, `dist-lib` and the project fixture; records which library files were fetched. */
async function serve(tab: Page, html: string): Promise<{ library: string[] }> {
  const library: string[] = [];
  await tab.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const cors = { 'access-control-allow-origin': '*' };
    if (url.origin === HOST) return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (url.origin === CDN && url.pathname.startsWith('/jeex/v1/')) {
      const name = url.pathname.slice('/jeex/v1/'.length);
      library.push(name);
      const file = join(DIST, name);
      if (!existsSync(file)) return route.fulfill({ status: 404, headers: cors, body: '' });
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: TYPES[extname(file)] ?? 'application/octet-stream',
        body: readFileSync(file),
      });
    }
    if (url.origin === CDN && url.pathname.startsWith('/p/flat/')) {
      const file = join(ROOT, 'tests/fixtures/project', url.pathname.slice('/p/flat/'.length));
      if (existsSync(file)) {
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: TYPES[extname(file)] ?? 'application/octet-stream',
          body: readFileSync(file),
        });
      }
    }
    return route.fulfill({ status: 404, headers: cors, body: '' });
  });
  return { library };
}

/** Counts the WebGL contexts the page creates and sums its layout shifts, from before any script runs. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record = { contexts: 0, shift: 0 };
    (window as unknown as { __loadCost: typeof record }).__loadCost = record;
    const seen = new WeakSet<object>();
    const prototype = HTMLCanvasElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext')!;
    const original = descriptor.value as (this: HTMLCanvasElement, ...args: unknown[]) => unknown;
    const counted = function (this: HTMLCanvasElement, ...args: unknown[]): unknown {
      const context = original.apply(this, args);
      if (context !== null && typeof context === 'object' && (args[0] === 'webgl2' || args[0] === 'webgl') && !seen.has(context)) {
        seen.add(context);
        record.contexts += 1;
      }
      return context;
    };
    Object.defineProperty(prototype, 'getContext', { ...descriptor, value: counted });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) record.shift += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

const loadCost = (page: Page): Promise<{ contexts: number; shift: number }> =>
  page.evaluate(() => (window as unknown as { __loadCost: { contexts: number; shift: number } }).__loadCost);

test.beforeAll(() => {
  expect(existsSync(join(DIST, 'jeex-viewer-element.js')), 'tests/built needs the library build: run `bun run build:lib` first').toBe(true);
});

/** Waits for the player's `:state(ready)`. */
const ready = (tab: Page): Promise<unknown> =>
  tab.waitForFunction(() => document.querySelector('#player')?.matches(':state(ready)') === true, undefined, { timeout: READY_TIMEOUT_MS });

/**
 * The layout shift a player's own boot causes when it starts at once: the
 * loading card's centred label changes width between the boot steps, inside
 * the player's box. A deferred start may cause that much, and nothing more.
 */
async function eagerShift(tab: Page): Promise<number> {
  await instrument(tab);
  await serve(tab, ABOVE_THE_FOLD);
  await tab.goto(`${HOST}/`, { waitUntil: 'load' });
  await ready(tab);
  return (await loadCost(tab)).shift;
}

test('a below-the-fold element fetches no viewer chunk and makes no WebGL context until it is scrolled near', async ({ page, context }) => {
  const control = await eagerShift(await context.newPage());
  await instrument(page);
  const served = await serve(page, BELOW_THE_FOLD);
  await page.goto(`${HOST}/`, { waitUntil: 'load' });
  const box = await page.locator('#player').boundingBox();
  // Two seconds of an idle page: nothing is waiting on the network or on a frame.
  await page.waitForTimeout(2_000);

  const beforeStart = [...served.library];
  expect(beforeStart.some((name) => name.startsWith('lazy-jeex-viewer-element-runtime-'))).toBe(false);
  expect(beforeStart.some((name) => name.startsWith('jeex-viewer-three.'))).toBe(false);
  expect(beforeStart.some((name) => name.startsWith('jeex-viewer-viewer-api-'))).toBe(false);
  expect((await loadCost(page)).contexts).toBe(0);
  // The box is the player's final size from the first layout on.
  expect(box?.height).toBeCloseTo((box!.width * 9) / 16, 0);

  await page.locator('#player').scrollIntoViewIfNeeded();
  await ready(page);
  expect(served.library.some((name) => name.startsWith('lazy-jeex-viewer-element-runtime-'))).toBe(true);
  const after = await loadCost(page);
  expect(after.contexts).toBe(1);
  // No layout moved beyond what an eager start moves: the start filled the
  // box the element already held.
  expect(after.shift).toBeLessThanOrEqual(control + 1e-4);
  const started = await page.locator('#player').boundingBox();
  expect([started?.width, started?.height]).toEqual([box?.width, box?.height]);
});

test('an eager element below the fold starts at load, without a scroll', async ({ page }) => {
  await instrument(page);
  const served = await serve(page, EAGER_BELOW_THE_FOLD);
  await page.goto(`${HOST}/`, { waitUntil: 'load' });
  await ready(page);
  expect(served.library.some((name) => name.startsWith('lazy-jeex-viewer-element-runtime-'))).toBe(true);
  expect((await loadCost(page)).contexts).toBe(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
