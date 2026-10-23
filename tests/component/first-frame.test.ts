/**
 * The first picture waits for the scene's shaders (`src/render/first-draw.ts`),
 * in a real browser: the frame loop runs while `compileAsync` is pending and
 * draws nothing, the first display draw follows the compilation (or the 1 s
 * bound when it never resolves), `ready` follows the first picture, and the
 * picture is the one the player drew before.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { FIRST_DRAW_BOUND_MS, FirstDrawGate } from '../../src/render/first-draw.js';
import { closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

const MOUNT_TIMEOUT_MS = 180_000;

const debug = () => window.__viewerDebug!;

/** Share of pixels of two PNG screenshots (base64) that differ by more than 8 levels in any channel. */
async function differingShare(a: string, b: string): Promise<number> {
  const pixels = async (png: string): Promise<Uint8ClampedArray> => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  };
  const [left, right] = [await pixels(a), await pixels(b)];
  let differing = 0;
  for (let i = 0; i < left.length; i += 4) {
    if (Math.max(Math.abs(left[i]! - right[i]!), Math.abs(left[i + 1]! - right[i + 1]!), Math.abs(left[i + 2]! - right[i + 2]!)) > 8)
      differing += 1;
  }
  return differing / (left.length / 4);
}

const handles: ViewerHandle[] = [];

const arm = Object.getOwnPropertyDescriptor(FirstDrawGate.prototype, 'arm')!.value as FirstDrawGate['arm'];

/**
 * Hands the first-draw gate `wait` in place of the renderer's own compilation
 * (`compileAsync` is an instance property of three's renderer, so the gate is
 * the seam): `start` runs the real compilation first when it is asked for.
 */
function gateWith(wait: (start: () => Promise<unknown>) => Promise<unknown> | null): { calls: () => number } {
  let calls = 0;
  vi.spyOn(FirstDrawGate.prototype, 'arm').mockImplementation(function (this: FirstDrawGate, compile) {
    if (compile === null) {
      arm.call(this, null);
      return;
    }
    calls += 1;
    const waited = wait(compile);
    arm.call(this, waited === null ? null : () => waited);
  });
  return { calls: () => calls };
}

function mount(): ViewerHandle {
  const handle = mountViewer(openContainer(480, 320), {
    scene: { repository: new InlineSceneRepository(demoScene()) },
    tour: { mode: 'off' },
    debug: true,
  });
  handles.push(handle);
  return handle;
}

/** A still picture of the orbit opening view, once the camera has settled and nothing draws. */
async function settledShot(): Promise<string> {
  for (let round = 0; round < 60; round += 1) {
    const before = await page.screenshot({ save: false });
    for (let frame = 0; frame < 10; frame += 1) await nextFrame();
    if ((await page.screenshot({ save: false })) === before) return before;
  }
  throw new Error('the view never settled');
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  vi.restoreAllMocks();
  closeContainers();
});

describe('the first picture waits for the shaders', { timeout: MOUNT_TIMEOUT_MS }, () => {
  test('ticks run and nothing is drawn while compiling; the draw follows the compilation and `ready` follows the draw', async () => {
    let finish: () => void = () => undefined;
    let armedAt = 0;
    const compileAsync = gateWith((start) => {
      void start();
      armedAt = performance.now();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const order: string[] = [];
    const handle = mount();
    void handle.ready.then(() => order.push('ready'));
    await until(() => compileAsync.calls() > 0, 'the compilation to start', 120_000);
    await until(() => (window.__viewerDebug?.renderDemand().ticks ?? 0) > 0, 'the first tick', 60_000);
    const ticks = debug().renderDemand().ticks;
    for (let frame = 0; frame < 5; frame += 1) await nextFrame();
    // Meaningful only inside the bound, which runs from the end of the compilation's synchronous part.
    expect(performance.now() - armedAt).toBeLessThan(FIRST_DRAW_BOUND_MS);
    expect(debug().renderDemand().ticks).toBeGreaterThan(ticks);
    expect(debug().renderDemand().draws).toBe(0);
    expect(order).toEqual([]);
    finish();
    await until(() => debug().renderDemand().draws > 0, 'the first draw', 60_000);
    order.push('drawn');
    await handle.ready;
    expect(order).toEqual(['drawn', 'ready']);
  });

  test('a compilation that never resolves draws at the bound', async () => {
    let started = 0;
    gateWith(() => {
      started = performance.now();
      return new Promise<void>(() => {});
    });
    const handle = mount();
    await until(() => started > 0, 'the compilation to start', 120_000);
    await until(() => (window.__viewerDebug?.renderDemand().draws ?? 0) > 0, 'the first draw at the bound', 60_000);
    expect(performance.now() - started).toBeGreaterThanOrEqual(FIRST_DRAW_BOUND_MS - 20);
    await handle.ready;
  });

  test('the first picture is the one the player drew without asynchronous compilation', async () => {
    const withCompile = mount();
    await withCompile.ready;
    const compiled = await settledShot();
    withCompile.dispose();
    handles.length = 0;
    closeContainers();
    // The player as it drew before: three's synchronous link at the first draw.
    gateWith(() => null);
    const direct = mount();
    await direct.ready;
    const before = await settledShot();
    expect(await differingShare(before, compiled)).toBeLessThan(0.01);
  });

  test('a viewer mounted hidden fires `ready` once its shaders are ready, and draws when shown', async () => {
    const container = openContainer(480, 320);
    container.style.display = 'none';
    const handle = mountViewer(container, {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      debug: true,
    });
    handles.push(handle);
    await handle.ready;
    expect(window.__appReady).toBe(true);
    expect(debug().renderDemand().draws).toBe(0);
    container.style.display = '';
    await until(() => debug().renderDemand().draws > 0, 'the first picture once shown', 60_000);
  });
});
