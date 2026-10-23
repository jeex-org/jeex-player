/**
 * The BUILT library (`dist-lib/`, from `bun run build:lib`) finds the Basis
 * transcoder from every embed shape: the ES entry, the custom element, the
 * iframe page and the classic IIFE.
 *
 * Nothing here runs against Vite: the dev server answers the transcoder's
 * names on any path, so only the built files can show where a shipped player
 * really looks. Every request is answered by routing, on two invented origins:
 * the host page on `HOST`, the library and the project on `CDN` under a folder
 * of their own, as a delivery host would serve them. The project is the
 * library fixture with its scan shipped as KTX2 maps.
 *
 * Each shape must fetch both transcoder files from the library folder, once
 * and only from there, fetch its three maps, and raise no texture warning.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist-lib');
const HOST = 'https://host.jeex.test';
const CDN = 'https://cdn.jeex.test';
const LIB = `${CDN}/jeex/v1/`;
const PROJECT = `${CDN}/p/flat/project.json`;
/** How long a shape may take to fetch its maps and transcode them. */
const DRAW_TIMEOUT_MS = 45_000;

const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.html': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ktx2': 'image/ktx2',
};

/** The library fixture's manifest with its scan listed once, at 256 px, as KTX2. */
function ktx2Manifest(): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/project-library/project.json'), 'utf8')) as {
    library: { materials: { library?: { versionId: string; kind: string; maps: Record<string, { files: Record<string, string> }> } }[] };
  };
  for (const material of manifest.library.materials) {
    const library = material.library;
    if (library?.kind !== 'scan') continue;
    for (const [role, map] of Object.entries(library.maps)) map.files = { '256': `tex/${library.versionId}/${role}.256.ktx2` };
  }
  return JSON.stringify(manifest);
}

/** Answers every request of `page` from `dist-lib`, the fixtures and the host `html`, and records the transcoder requests. */
async function serve(page: Page, html: string): Promise<{ transcoder: string[]; maps: string[]; warnings: string[] }> {
  const transcoder: string[] = [];
  const maps: string[] = [];
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[jeex-viewer]')) warnings.push(message.text());
  });
  const manifest = ktx2Manifest();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const cors = { 'access-control-allow-origin': '*' };
    if (url.pathname.includes('lazy-jeex-viewer-basis-transcoder-')) transcoder.push(url.href);
    if (url.origin === HOST) return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (url.origin === CDN && url.pathname.startsWith('/jeex/v1/')) {
      const file = join(DIST, url.pathname.slice('/jeex/v1/'.length));
      if (!existsSync(file)) return route.fulfill({ status: 404, headers: cors, body: '' });
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: TYPES[extname(file)] ?? 'application/octet-stream',
        body: readFileSync(file),
      });
    }
    if (url.origin === CDN && url.pathname.startsWith('/p/flat/')) {
      const rest = url.pathname.slice('/p/flat/'.length);
      if (rest === 'project.json') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: manifest });
      if (rest.endsWith('.ktx2')) {
        maps.push(rest);
        const role = rest.split('/').pop()!.split('.')[0]!;
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'image/ktx2',
          body: readFileSync(join(ROOT, `tests/fixtures/ktx2/${role}.256.ktx2`)),
        });
      }
      const file = join(ROOT, 'tests/fixtures/project-library', rest);
      if (existsSync(file))
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: TYPES[extname(file)] ?? 'application/octet-stream',
          body: readFileSync(file),
        });
    }
    return route.fulfill({ status: 404, headers: cors, body: '' });
  });
  return { transcoder, maps, warnings };
}

/** The two URLs a correct player asks for: the built pair, in the library folder. */
function expectedTranscoder(): string[] {
  const names = readdirSync(DIST).filter((name) => name.startsWith('lazy-jeex-viewer-basis-transcoder-'));
  expect(names.map((name) => extname(name)).sort()).toEqual(['.js', '.wasm']);
  return names.map((name) => `${LIB}${name}`).sort();
}

test.beforeAll(() => {
  expect(existsSync(join(DIST, 'jeex-viewer.js')), 'tests/built needs the library build: run `bun run build:lib` first').toBe(true);
});

const SHAPES: readonly [string, string][] = [
  [
    'the ES module entry',
    `<!doctype html><div id="v" style="width:400px;height:300px"></div><script type="module">import { mountViewer } from '${LIB}jeex-viewer.js'; mountViewer(document.getElementById('v'), { scene: { url: '${PROJECT}' } });</script>`,
  ],
  [
    'the custom element',
    `<!doctype html><script type="module" src="${LIB}jeex-viewer-element.js"></script><jeex-viewer src="${PROJECT}" style="display:block;width:400px;height:300px"></jeex-viewer>`,
  ],
  [
    'the classic IIFE',
    `<!doctype html><script src="${LIB}jeex-viewer.iife.js"></script><jeex-viewer src="${PROJECT}" style="display:block;width:400px;height:300px"></jeex-viewer>`,
  ],
  [
    'the iframe page',
    `<!doctype html><iframe src="${LIB}embed.html?scene=${encodeURIComponent(PROJECT)}" style="width:400px;height:300px"></iframe>`,
  ],
];

for (const [shape, html] of SHAPES) {
  test(`${shape} fetches the transcoder pair from the library folder and draws its KTX2 maps`, async ({ page }) => {
    const served = await serve(page, html);
    await page.goto(`${HOST}/`);
    await expect.poll(() => [...served.transcoder].sort(), { timeout: DRAW_TIMEOUT_MS }).toEqual(expectedTranscoder());
    await expect.poll(() => served.maps.length, { timeout: DRAW_TIMEOUT_MS }).toBe(3);
    // A built page has no debug API to read the drawn maps back; a map that is not drawn says
    // so in a `texture-*` warning, so the page is given time to transcode and must stay silent.
    await page.waitForTimeout(3_000);
    expect(served.warnings.filter((line) => /texture-|ktx2/.test(line))).toEqual([]);
    expect([...served.transcoder].sort()).toEqual(expectedTranscoder());
  });
}
