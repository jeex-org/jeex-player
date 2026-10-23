/**
 * Draws the shared noise tiles (`noise-tiles.ts`) ahead of the build, in
 * slices that leave the main thread every few milliseconds.
 *
 * Painted on demand, the tiles land inside the one task that builds the
 * scene: on a measured boot they were most of 230-290 ms of procedural
 * texture work, a single long task on top of the mount. Drawn here first,
 * while the scene document is still on its way, each slice is a short task
 * of its own and the build finds every tile in the cache.
 *
 * Pixels invariant: a sliced tile runs the same row loop as an on-demand one
 * (`fillNoiseRows`) and enters the cache only when complete, under the same
 * key, so nothing on screen depends on which of the two drew it. A tile the
 * build needs before the prewarm got to it is simply drawn on demand, as
 * before; one already cached is skipped.
 */

import { createCanvas2D } from './canvas-2d.js';
import { fillNoiseRows } from './texture-canvas.js';
import { sharedTextureCache, type TextureCache } from './texture-cache.js';
import type { NoiseTileSpec } from './noise-tiles.js';

/** How long one slice may run before it yields, ms: well inside the 50 ms of a long task, also at 4x CPU throttling. */
export const SLICE_MS = 8;
/** Rows drawn between two looks at the clock. */
const ROWS_PER_STEP = 8;

type SchedulerWithYield = { yield: () => Promise<void> };

/**
 * Gives the main thread back for one task.
 *
 * `scheduler.yield()` where the browser has it: the continuation keeps its
 * priority over other queued work. Otherwise a `MessageChannel` message, not
 * `setTimeout(0)`, which browsers clamp to 4 ms after a few nested calls.
 */
export function yieldTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Partial<SchedulerWithYield> }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** The clock and the yield the prewarm runs on; a test supplies its own. */
type PrewarmClock = { now: () => number; yieldTask: () => Promise<void> };

const DEFAULT_CLOCK: PrewarmClock = { now: () => performance.now(), yieldTask };

/**
 * Draws every tile of `tiles` that is not cached yet, slicing on `SLICE_MS`.
 * Resolves when all are cached or `signal` aborted (a viewer disposed while
 * booting); never rejects, because a tile it did not draw costs only time.
 */
export async function prewarmNoiseTiles(
  tiles: readonly NoiseTileSpec[],
  signal: AbortSignal,
  clock: PrewarmClock = DEFAULT_CLOCK,
  cache: TextureCache = sharedTextureCache,
): Promise<void> {
  let deadline = clock.now() + SLICE_MS;
  for (const spec of tiles) {
    if (cache.canvas(spec.key)) continue;
    const surface = createCanvas2D(spec.size);
    if (!surface) return;
    const image = surface.ctx.createImageData(spec.size, spec.size);
    for (let row = 0; row < spec.size; row += ROWS_PER_STEP) {
      if (clock.now() >= deadline) {
        await clock.yieldTask();
        if (signal.aborted) return;
        deadline = clock.now() + SLICE_MS;
      }
      fillNoiseRows(spec, image.data, row, Math.min(spec.size, row + ROWS_PER_STEP));
    }
    // Drawn on demand while this one was being sliced: keep the one in use.
    if (cache.canvas(spec.key)) continue;
    surface.ctx.putImageData(image, 0, 0);
    cache.putCanvas(spec.key, surface.canvas);
  }
}
