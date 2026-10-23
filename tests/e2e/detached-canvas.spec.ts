/**
 * A host that removes a viewer from the page WITHOUT `dispose()`.
 *
 * `dispose()` is the documented teardown, but a viewer that was only taken off
 * the page used to keep its animation-frame loop and kept drawing into its
 * detached canvas; on a software rasteriser that starved the browser enough
 * to stall the next page load for about a minute. The loop now parks while
 * the canvas is not in a document and resumes when the host puts it back.
 *
 * The signal is the one the defect is about, WebGL draw calls: the draw
 * entry points of both context prototypes are wrapped before any module loads.
 * With the demo viewer disposed, the probe viewer is the only thing drawing,
 * and one-shot `requestAnimationFrame` callbacks (a coalesced resize, a boot
 * wait) do not count. The quiet stretch is longer than the plan view's
 * keep-warm heartbeat (`KEEP_WARM_MS`), so a heartbeat would show too.
 */

import { expect, test } from '@playwright/test';
import { waitForBoot } from './support.js';

/** The page's modules, imported inside the page (see `leaks.spec.ts` for why through a computed path). */
type ViewerModule = {
  mountViewer: (container: HTMLElement, options: unknown) => { ready: Promise<void>; dispose(): void };
  InlineSceneRepository: new (scene: unknown) => unknown;
};
type SceneModule = { apartmentScene: unknown };
type ProbeWindow = Window & {
  __draws: number;
  __probe?: { box: HTMLElement; host: HTMLElement; dispose(): void };
};

/** Long enough for any frame already queued at removal to have run, ms. */
const SETTLE_MS = 1_000;
/** The stretch over which a parked loop must draw nothing at all, ms. */
const QUIET_MS = 1_500;
/** Draw calls that prove the loop is drawing again: more than one stray call could explain. */
const RUNNING_DRAWS = 3;

const draws = async (page: import('@playwright/test').Page): Promise<number> =>
  page.evaluate(() => (window as unknown as ProbeWindow).__draws);

test('a viewer removed without dispose stops drawing, and drawing resumes when it is put back', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as unknown as ProbeWindow;
    probe.__draws = 0;
    const methods = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const table = proto as unknown as Record<string, (...args: unknown[]) => unknown>;
      for (const method of methods) {
        const original = table[method];
        if (typeof original !== 'function') continue;
        table[method] = function (this: unknown, ...args: unknown[]) {
          probe.__draws += 1;
          return original.apply(this, args);
        };
      }
    }
  });
  await page.goto('/');
  await waitForBoot(page, 'window.__appReady === true');
  await page.evaluate(() => window.jeexViewer?.dispose());

  await page.evaluate(async () => {
    const load = <T>(path: string): Promise<T> => import(/* @vite-ignore */ path) as Promise<T>;
    const api = await load<ViewerModule>('/src/app/viewer-api.js');
    const scene = await load<SceneModule>('/src/demo/scene-data.js');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const box = document.createElement('div');
    box.style.cssText = 'width:640px;height:400px';
    host.appendChild(box);
    const handle = api.mountViewer(box, {
      scene: { repository: new api.InlineSceneRepository(scene.apartmentScene) },
      tour: { mode: 'off' },
      debug: false,
    });
    await handle.ready;
    (window as unknown as ProbeWindow).__probe = { box, host, dispose: () => handle.dispose() };
  });

  const attached = await draws(page);
  await expect.poll(() => draws(page)).toBeGreaterThanOrEqual(attached + RUNNING_DRAWS);

  // The host takes the viewer's container off the page and does not dispose it.
  await page.evaluate(() => (window as unknown as ProbeWindow).__probe?.box.remove());
  await page.waitForTimeout(SETTLE_MS);
  const parked = await draws(page);
  await page.waitForTimeout(QUIET_MS);
  expect(await draws(page), 'nothing may be drawn while the canvas is off the page').toBe(parked);

  // The host puts the same element back: the loop resumes by itself.
  await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__probe;
    probe?.host.appendChild(probe.box);
  });
  await expect.poll(() => draws(page)).toBeGreaterThanOrEqual(parked + RUNNING_DRAWS);

  await page.evaluate(() => (window as unknown as ProbeWindow).__probe?.dispose());
});
