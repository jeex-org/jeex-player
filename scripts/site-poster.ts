/**
 * Poster of the player site: a real render of the demo apartment, made by the
 * viewer's own documented capture (`handle.capture.still`, README «Capture:
 * stills, panoramas and provenance») on the standalone demo page.
 *
 * Serves the demo build `dist/` on 127.0.0.1 (port `SITE_POSTER_PORT`, default
 * 3704, the site's preview port), opens `index.html` in a
 * headless Chromium (`tests/headless-webgl.ts`: SwiftShader by default,
 * `JEEX_BROWSER_GPU=nvidia` to render on an NVIDIA GPU when available), waits for `window.jeexViewer.ready`
 * and writes the 1600×900 presentation-camera still as a PNG to the path in
 * the first argument (default `site-out/poster.png`). Converting it to the
 * committed `site/assets/poster.webp` and cropping `og.png` is `magick`'s job
 * (`site/assets/poster.md` records the commands).
 *
 * Usage: `bun run build && bun run scripts/site-poster.ts [out.png]`.
 */

import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { headlessWebglLaunch } from '../tests/headless-webgl.js';
import type { ViewerHandle } from '../src/app/viewer-api.js';

declare global {
  interface Window {
    /** Published by the demo page (`src/main.ts`), read here in the page context. */
    jeexViewer?: ViewerHandle;
  }
}

/** The capture request: a 1600×900 still from the presentation camera. */
const STILL = { width: 1600, height: 900, camera: 'presentation', state: 'current' } as const;

/** How long the demo may take to draw its first frame on a software renderer. */
const READY_TIMEOUT_MS = 180_000;

/** A static file server over `dir`, `index.html` for the root. */
function serveDir(dir: string, port: number): { stop: () => void } {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const target = resolve(join(dir, path === '/' ? 'index.html' : path));
      if (!target.startsWith(`${dir}/`)) return new Response('not found', { status: 404 });
      const file = Bun.file(target);
      return file.size > 0 ? new Response(file) : new Response('not found', { status: 404 });
    },
  });
  return { stop: () => void server.stop(true) };
}

async function main(): Promise<void> {
  const dist = resolve('dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('site-poster: dist/index.html is missing: run `bun run build` first');
  const out = resolve(process.argv[2] ?? 'site-out/poster.png');
  const port = Number(process.env['SITE_POSTER_PORT'] ?? '3704');
  const server = serveDir(dist, port);
  const browser = await chromium.launch({ headless: true, ...headlessWebglLaunch() });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(`http://127.0.0.1:${String(port)}/index.html?lang=en`);
    await page.waitForFunction(() => window.jeexViewer !== undefined, undefined, { timeout: READY_TIMEOUT_MS });
    const base64 = await page.evaluate(async (request) => {
      const viewer = window.jeexViewer!;
      await viewer.ready;
      const { blob } = await viewer.capture.still(request);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCodePoint(byte);
      return btoa(binary);
    }, STILL);
    if (pageErrors.length > 0) throw new Error(`site-poster: page errors: ${pageErrors.join('; ')}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(base64, 'base64'));
    console.log(`site-poster: wrote ${out} (${String(STILL.width)}x${String(STILL.height)}, camera ${STILL.camera}, state ${STILL.state})`);
  } finally {
    await browser.close();
    server.stop();
  }
}

await main();
