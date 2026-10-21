/**
 * What every component test needs and none of them should own: a container
 * that is really in the page, a built shell, and the demo apartment as a
 * solved plan.
 *
 * It is deliberately NOT `src/fixtures/stubs.ts`. That file holds the stubs
 * the `bun test` layer needs because it has no browser; this one holds the
 * opposite — helpers that only work BECAUSE there is one.
 */

import { createViewerShell, type ViewerRoots } from '../../src/ui/viewer-shell.js';
import { createMessages, type Messages } from '../../src/ui/messages.js';
import { solvePlan, type SolvedPlan } from '../../src/plan/plan-solver.js';
import { buildPlanDrawing, type PlanDrawing } from '../../src/plan/plan-drawing.js';
import { planDrawingInputs } from '../../src/assets/plan-fixtures.js';
import { apartmentScene } from '../../src/demo/scene-data.js';
import type { SceneData } from '../../src/scene/types.js';

/** Every container this module handed out, so a test file can drop them all. */
const OPENED: HTMLElement[] = [];

/**
 * A sized container attached to the document.
 *
 * The size is explicit because almost everything downstream measures it: the
 * renderer's drawing buffer, the plan overlay's fit, the panel's clamp. A
 * zero-height box would make each of those a no-op and the test would pass by
 * doing nothing.
 */
export function openContainer(width = 900, height = 600): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = `position:relative;width:${width}px;height:${height}px`;
  document.body.appendChild(container);
  OPENED.push(container);
  return container;
}

/** Removes every container `openContainer` made. Call from `afterEach`. */
export function closeContainers(): void {
  for (const container of OPENED.splice(0)) container.remove();
}

export type Shell = { container: HTMLElement; roots: ViewerRoots; messages: Messages };

/** A container with the real shell built inside it. */
export function openShell(width?: number, height?: number): Shell {
  const container = openContainer(width, height);
  const messages = createMessages('en');
  return { container, roots: createViewerShell(container, messages), messages };
}

/** The demo apartment, solved once and shared: solving it is not the subject. */
let solved: SolvedPlan | null = null;
export function demoPlan(): SolvedPlan {
  solved ??= solvePlan(apartmentScene);
  return solved;
}

let drawing: PlanDrawing | null = null;
export function demoDrawing(): PlanDrawing {
  drawing ??= buildPlanDrawing(demoPlan(), apartmentScene, planDrawingInputs(apartmentScene));
  return drawing;
}

export function demoScene(): SceneData {
  return apartmentScene;
}

/**
 * A fixed pause.
 *
 * Used only where the assertion is that something did NOT happen — there is no
 * predicate for an event that must never arrive, so a bounded wait is the
 * honest shape. Everything else waits on `until`.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Parks a mounted viewer in `plan2d`, which stops the 3D render loop, before
 * a test exports the committed document.
 *
 * An export never reads the live view: `prepareExport` builds its own graph
 * from the committed document. But on SwiftShader every 3D frame holds the
 * page's main thread in the GL command buffer for about a second, and the
 * exporter's own awaits (texture encoding, `FileReader`) queue behind those
 * frames. Measured on four hardware threads, one test at a time, over the
 * L-shape plan: the frame bridge's `exportGlb` took 18.1 s with the loop
 * running and 6.7 s parked, `exportUsdz` 29.5 s and 5.7 s. With two Vitest
 * workers on a hosted runner the running loop pushed both past their budgets.
 */
export function parkForExport(handle: { setMode(mode: 'plan2d'): void }): void {
  handle.setMode('plan2d');
}

/** One animation frame; the unit of time everything in the viewer is measured in. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Waits until `predicate` holds, or fails the caller by timing out.
 *
 * A polled predicate rather than a fixed sleep, for the same reason
 * `scripts/browser-check` prefers `wait --fn`: a sleep is a flake on a loaded
 * machine and dead time on a fast one.
 *
 * The default budget is generous because the thing most often waited for is a
 * scene build on SwiftShader — seconds, not frames — and the cost of a
 * generous budget is paid only by a test that was going to fail anyway.
 */
export async function until(predicate: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await nextFrame();
  }
}

/**
 * What a wait for the lazily loaded asset move chunk (`app/asset-move-wiring.ts`)
 * gets instead of `until`'s 15 s.
 *
 * Arming the tool imports a module graph from the dev server and builds the
 * session once it lands. On four hardware threads with two Vitest workers
 * (the shape of a CI runner), in the shard that runs `asset-move`,
 * `asset-mirror` and `frame-bridge` side by side, that wait ran past 15 s in
 * two runs out of two (two tests each, cold and warm imports alike), while
 * the same tests passed on a 16-thread machine. 45 s is the budget
 * `frame-bridge.test.ts` gives work that competes for the shared rasteriser.
 */
export const ASSET_MOVE_CHUNK_TIMEOUT_MS = 45_000;

/**
 * Waits until `predicate` holds within `frames` animation frames, or fails.
 *
 * For motion on the viewer's frame clock (a glide, a ride), whose length is a
 * number of FRAMES — each advances the clock by at most `MAX_FRAME_DELTA` —
 * and therefore any number of seconds on a loaded SwiftShader. A wall-clock
 * budget there measures the machine, not the viewer.
 */
export async function untilFrames(predicate: () => boolean, what: string, frames: number): Promise<void> {
  for (let frame = 0; !predicate(); frame += 1) {
    if (frame >= frames) throw new Error(`no ${what} within ${frames} frames`);
    await nextFrame();
  }
}

/** Frames a settling camera gets: two seconds of the viewer's clock at `MAX_FRAME_DELTA` (0.05 s) a frame, tripled. */
export const SETTLE_FRAMES = 120;

/**
 * Waits until the camera holds its pose for `still` consecutive rendered
 * frames, within `frames` frames: the fit that follows the canvas size, a
 * walk entry and a scene swap all ease on the frame clock, so their end is a
 * number of frames, not of seconds. A pick, a click probe or a "stopped"
 * check against a camera still easing tests the easing, not the feature.
 */
export async function untilCameraStill(what: string, frames = SETTLE_FRAMES, still = 5): Promise<{ x: number; y: number; z: number }> {
  const pose = (): { x: number; y: number; z: number } => {
    const camera = window.__viewerDebug?.camera() ?? null;
    if (camera === null) throw new Error('the debug surface has no camera');
    return camera;
  };
  let last = pose();
  // -1: the first check runs in the frame `last` was read in and proves no
  // stillness; only comparisons across a rendered frame count.
  let held = -1;
  await untilFrames(
    () => {
      const now = pose();
      held = Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z) < 1e-6 ? held + 1 : 0;
      last = now;
      return held >= still;
    },
    what,
    frames,
  );
  return last;
}

/** Whether a canvas has any non-transparent pixel: "it painted", cheaply. */
export function canvasHasInk(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > 0) return true;
  }
  return false;
}
