/**
 * Does a disposed viewer actually go away?
 *
 * "Mount/dispose × 20" is one of the release blockers, checked here as a
 * Playwright test. Two questions, and
 * they are different:
 *
 * ① after twenty cycles, is the page still holding twenty canvases and twenty
 *    heaps' worth of geometry — the arithmetic answer; and
 * ② is the `ViewerApp` object itself COLLECTABLE — the answer a
 *    `FinalizationRegistry` gives, with the garbage collector forced through
 *    CDP so the test does not depend on when the browser feels like running it.
 *
 * `performance.memory` is Chromium-only and quantised; the heap assertion is
 * skipped where it is absent rather than made up.
 */

import { expect, test } from '@playwright/test';
import { waitForBoot } from './support.js';

/**
 * The shapes the page's own modules are used through.
 *
 * Each `page.evaluate` below imports them INSIDE the page, through a computed
 * path: a literal would send the TypeScript checker looking for a server URL
 * on the file system, and `@vite-ignore` keeps Vite from trying to pre-bundle
 * it. What comes back is the module `index.html` already loaded, so the cycles
 * run the real composition root and not a copy of it.
 */
type ViewerModule = {
  mountViewer: (container: HTMLElement, options: unknown) => { ready: Promise<void>; dispose(): void };
  InlineSceneRepository: new (scene: unknown) => unknown;
};
type SceneModule = { apartmentScene: unknown };

/** Enough cycles that a per-mount leak is unmistakable, few enough to run in CI. */
const CYCLES = 20;

/**
 * Headroom over the first cycle's heap.
 *
 * `usedJSHeapSize` is quantised and moves with whatever else the page is
 * doing, so a tight bound would be a flake generator. 2.5× catches "every
 * viewer is still in memory" (which would be ~20×) and lets ordinary growth
 * through.
 */
const HEAP_GROWTH_LIMIT = 2.5;

test('twenty mount/dispose cycles leave no canvases and no runaway heap', async ({ page }) => {
  // Twenty full demo mounts inside one `page.evaluate` sit at the edge of
  // Playwright's 60 s default timeout. The assertions are about leaks (canvas
  // count, heap growth), not speed, so this stress test declares itself slow
  // (tripling its own timeout to 180 s) rather than the whole suite lowering
  // `workers`.
  test.slow();
  await page.goto('/');
  await waitForBoot(page, 'window.__appReady === true');
  // The demo page's own viewer is disposed before the cycles start. While it
  // eases or animates it draws a frame on every animation frame, and every step of a cycle's boot that
  // waits for a task queues behind that frame: under SwiftShader on a loaded
  // machine a frame took 2.4 s and a cycle 7 s with the page's viewer drawing,
  // 1.1 s with it disposed, so twenty cycles ran past the 180 s budget on
  // frame cost alone. Its modules stay loaded, which is all the cycles reuse,
  // and the first heap reading is taken after it is gone.
  await page.evaluate(() => window.jeexViewer?.dispose());

  const result = await page.evaluate(async (cycles: number) => {
    const load = <T>(path: string): Promise<T> => import(/* @vite-ignore */ path) as Promise<T>;
    const api = await load<ViewerModule>('/src/app/viewer-api.js');
    const scene = await load<SceneModule>('/src/demo/scene-data.js');
    const heapOf = (): number | null => {
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return memory ? memory.usedJSHeapSize : null;
    };

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:640px;height:400px';
    document.body.appendChild(host);

    const canvasesAfter: number[] = [];
    const heaps: Array<number | null> = [];
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      const box = document.createElement('div');
      box.style.cssText = 'width:640px;height:400px';
      host.appendChild(box);
      const handle = api.mountViewer(box, {
        scene: { repository: new api.InlineSceneRepository(scene.apartmentScene) },
        tour: { mode: 'off' },
        debug: false,
      });
      await handle.ready;
      handle.dispose();
      // A disposed viewer's own root is the host's to remove today
      // (`ViewerApp.dispose` does not); if that changes, this line becomes
      // redundant rather than wrong.
      box.remove();
      canvasesAfter.push(host.querySelectorAll('canvas').length);
      heaps.push(heapOf());
    }
    host.remove();
    return { canvasesAfter, heaps, cycles };
  }, CYCLES);

  // Nothing accumulates in the DOM: every cycle ends with an empty host.
  expect(result.canvasesAfter).toEqual(Array.from({ length: CYCLES }, () => 0));

  const heaps = result.heaps.filter((value): value is number => value !== null);
  test.skip(heaps.length === 0, 'performance.memory is not available in this browser');
  const first = heaps[0]!;
  const last = heaps.at(-1)!;
  expect(last, `heap went from ${first} to ${last} over ${CYCLES} cycles`).toBeLessThan(first * HEAP_GROWTH_LIMIT);
});

test('a disposed ViewerApp is collected once the page drops its last reference', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page, 'window.__appReady === true');
  // Disposed first for the reason the twenty-cycle test gives: its frames
  // would stretch the probe's boot past the 60 s budget on a loaded machine.
  await page.evaluate(() => window.jeexViewer?.dispose());

  const client = await page.context().newCDPSession(page);
  await client.send('HeapProfiler.enable');

  await page.evaluate(async () => {
    const load = <T>(path: string): Promise<T> => import(/* @vite-ignore */ path) as Promise<T>;
    const api = await load<ViewerModule>('/src/app/viewer-api.js');
    const scene = await load<SceneModule>('/src/demo/scene-data.js');
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-9999px;top:0;width:640px;height:400px';
    document.body.appendChild(box);
    let handle: unknown = api.mountViewer(box, {
      scene: { repository: new api.InlineSceneRepository(scene.apartmentScene) },
      tour: { mode: 'off' },
      debug: false,
    });
    await (handle as { ready: Promise<void> }).ready;

    window.__leakProbe = { collected: false };
    const registry = new FinalizationRegistry(() => {
      window.__leakProbe!.collected = true;
    });
    // The HANDLE is what a host holds; everything else — the app, the
    // renderer, the scene graph — hangs off it.
    registry.register(handle as object, 'viewer');
    // Keep the registry itself alive; a collected registry never fires.
    window.__leakRegistry = registry;

    (handle as { dispose(): void }).dispose();
    box.remove();
    handle = null;
  });

  // Up to three collections: a young object promoted between the mark and the
  // sweep survives the first one, and the finalization callbacks run on a
  // later task than the collection itself.
  let collected = false;
  for (let attempt = 0; attempt < 3 && !collected; attempt += 1) {
    await client.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(250);
    collected = await page.evaluate(() => window.__leakProbe?.collected === true);
  }
  await client.detach();

  expect(collected, 'the disposed ViewerHandle was still reachable after three forced collections').toBe(true);
});

declare global {
  interface Window {
    __appReady?: boolean;
    __leakProbe?: { collected: boolean };
    __leakRegistry?: FinalizationRegistry<string>;
  }
}
