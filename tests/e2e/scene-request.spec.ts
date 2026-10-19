/**
 * Two facts about `VIEWER_VERSION` that only a real page can prove, kept in
 * one file.
 *
 * 1. The scene fetch carries the library's version in `Accept`, and does it
 *    WITHOUT a CORS preflight — the entire motive of keeping the header
 *    CORS-safelisted (habr.com/ru/articles/1078548).
 *    `dev/scene-request.html` mounts with `scene: { url }`, the one form
 *    that goes through `FetchSceneRepository`; `page.route` answers the
 *    request with the bundled demo apartment so the real scene fetch — not a
 *    fixture the test calls directly — is what is inspected.
 * 2. The IIFE bundle's `window.JeexViewer.VIEWER_VERSION` — the shape a
 *    `<script>`-tag host reads — equals `package.json#version`. `bun test`
 *    only sees `bunfig.toml`'s fixed placeholder (`src/shared/version.test.ts`);
 *    the real substitution happens in a Vite BUILD, so this is the one place
 *    that can check it. `check.sh`'s own `npm run build:lib` step runs after
 *    `test:e2e`, so this test builds its own fresh copy rather than trusting
 *    whatever `dist-lib/` happens to hold when this file runs.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { apartmentScene } from '../../src/demo/scene-data.js';
import { waitForBoot } from './support.js';

const SCENE_URL = '/e2e-fixtures/scene-request.json';

test('carries `jeex-viewer=<version>` in Accept and needs no OPTIONS preflight', async ({ page }) => {
  const methods: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(SCENE_URL)) methods.push(request.method());
  });
  await page.route(`**${SCENE_URL}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apartmentScene) });
  });

  const scenePromise = page.waitForRequest((request) => request.url().includes(SCENE_URL) && request.method() === 'GET');
  await page.goto('/dev/scene-request.html');
  const sceneRequest = await scenePromise;

  expect(sceneRequest.headers()['accept']).toContain('jeex-viewer=');

  // The viewer actually mounted with the fulfilled response: a header check
  // alone would pass even if the request never resolved into a scene.
  await waitForBoot(page, 'window.__appReady === true');

  expect(methods).toContain('GET');
  expect(methods).not.toContain('OPTIONS');
});

test('the built IIFE bundle publishes VIEWER_VERSION equal to package.json#version', async ({ page }) => {
  // A fresh build rather than a stale `dist-lib/`: `check.sh` runs this spec
  // file BEFORE its own `npm run build:lib` step (see the module header).
  execSync('npm run build:lib', { stdio: 'ignore' });
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

  // Loading the script alone has no side effect: `embed/index.ts` (the IIFE
  // entry) only exports — it registers no custom element and mounts nothing.
  await page.goto('/');
  await waitForBoot(page, 'window.__appReady === true');
  await page.addScriptTag({ url: '/dist-lib/jeex-viewer.iife.js' });

  const version = await page.evaluate(() => window.JeexViewer?.VIEWER_VERSION);
  expect(version).toBe(pkg.version);
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
});

declare global {
  interface Window {
    /** The IIFE global (`vite.lib.config.ts` `VIEWER_GLOBAL`); a `<script>`-tag host's whole surface. */
    JeexViewer?: { VIEWER_VERSION?: string };
    __appReady?: boolean;
  }
}
