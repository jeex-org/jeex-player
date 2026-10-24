/**
 * The BUILT library (`dist-lib/`, from `bun run build:lib`) finds the
 * bundled finishes' maps in the `finish-maps/` folder next to the player
 * file, from the ES entry and from the classic IIFE, and never asks the
 * host's `resolveTexture` for them. Without the folder every bundled surface
 * stays flat and the page logs one warning, not one per file.
 *
 * Every request is answered by routing, on two invented origins: the host
 * page on `HOST`, the library and a bare scene on `CDN`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist-lib');
const HOST = 'https://host.jeex.test';
const CDN = 'https://cdn.jeex.test';
const LIB = `${CDN}/jeex/v1/`;
const SCENE = `${CDN}/scenes/bare.json`;
const DRAW_TIMEOUT_MS = 45_000;

const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.html': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webp': 'image/webp',
};

/** Serves `html`, the library and the bare scene; records the map requests and the viewer's console lines. */
async function serve(page: Page, html: string, options: { folder: boolean }): Promise<{ maps: string[]; warnings: string[] }> {
  const maps: string[] = [];
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[jeex-viewer]')) warnings.push(message.text());
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const cors = { 'access-control-allow-origin': '*' };
    if (url.origin === HOST) return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (url.href === SCENE)
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(lShapePlan) });
    if (url.origin === CDN && url.pathname.startsWith('/jeex/v1/')) {
      const rest = url.pathname.slice('/jeex/v1/'.length);
      if (rest.startsWith('finish-maps/')) {
        maps.push(url.href);
        if (!options.folder) return route.fulfill({ status: 404, headers: cors, body: '' });
      }
      const file = join(DIST, rest);
      if (!existsSync(file)) return route.fulfill({ status: 404, headers: cors, body: '' });
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: TYPES[extname(file)] ?? 'application/octet-stream',
        body: readFileSync(file),
      });
    }
    return route.fulfill({ status: 404, headers: cors, body: '' });
  });
  return { maps, warnings };
}

test.beforeAll(() => {
  expect(existsSync(join(DIST, 'jeex-viewer.js')), 'tests/built needs the library build: run `bun run build:lib` first').toBe(true);
  expect(existsSync(join(DIST, 'finish-maps', 'SOURCES.md')), 'the library build ships finish-maps/').toBe(true);
});

const ES = `<!doctype html><div id="v" style="width:400px;height:300px"></div><script type="module">
  import { mountViewer } from '${LIB}jeex-viewer.js';
  window.resolved = [];
  mountViewer(document.getElementById('v'), { scene: { url: '${SCENE}' }, resolveTexture: (path) => { window.resolved.push(path); return path; } });
</script>`;
const IIFE = `<!doctype html><script src="${LIB}jeex-viewer.iife.js"></script><jeex-viewer src="${SCENE}" style="display:block;width:400px;height:300px"></jeex-viewer>`;

for (const [shape, html] of [
  ['the ES module entry', ES],
  ['the classic IIFE', IIFE],
] as const) {
  test(`${shape} fetches the bundled finishes' maps from the folder next to it`, async ({ page }) => {
    const served = await serve(page, html, { folder: true });
    await page.goto(`${HOST}/`);
    await expect.poll(() => served.maps.length, { timeout: DRAW_TIMEOUT_MS }).toBeGreaterThan(0);
    await page.waitForTimeout(3_000);
    expect(served.maps.every((url) => url.startsWith(`${LIB}finish-maps/tex/`) && url.endsWith('.webp'))).toBe(true);
    expect(served.warnings.filter((line) => line.includes('texture-'))).toEqual([]);
    if (shape === 'the ES module entry')
      expect(await page.evaluate(() => (window as unknown as { resolved: string[] }).resolved)).toEqual([]);
  });
}

test('without the folder the bundled surfaces stay flat and the page warns once', async ({ page }) => {
  const served = await serve(page, IIFE, { folder: false });
  await page.goto(`${HOST}/`);
  await expect.poll(() => served.maps.length, { timeout: DRAW_TIMEOUT_MS }).toBeGreaterThan(1);
  await page.waitForTimeout(3_000);
  expect(served.warnings.filter((line) => line.includes('texture-'))).toHaveLength(1);
});
