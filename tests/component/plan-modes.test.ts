/**
 * The two plan modes, against a REAL `RenderRuntime` on a real WebGL2 context.
 *
 * The runtime is not stubbed here on purpose: whether `setCamera` and
 * `setRenderEnabled` really put the orthographic top view in front of the
 * renderer is exactly the join a stub would paper over, and `bun test` had no
 * way to make that join real.
 */

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PlanModes, type PlanModeOptions } from '../../src/ui/plan-modes.js';
import { RenderRuntime } from '../../src/render/render-runtime.js';
import { fieldOfViewFor } from '../../src/camera/camera-tuning.js';
import { OVERLAY_NAMES } from '../../src/ui/viewer-shell.js';
import { projectAssetFacts, type AssetFactsSource } from '../../src/assets/asset-facts.js';
import { STORE_IDS } from '../fixtures/store-ids/store-ids.js';
import { canvasHasInk, closeContainers, demoPlan, demoScene, nextFrame, openShell, until, type Shell } from './support.js';

type Harness = { shell: Shell; runtime: RenderRuntime; modes: PlanModes; perspective: THREE.PerspectiveCamera };

/** Fill colour of the camera marker's dot (`drawing` palette's `accent`, `#dfbd7d`), exact and unmistakable. */
function hasAccentPixel(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 223 && data[i + 1] === 189 && data[i + 2] === 125) return true;
  }
  return false;
}

/**
 * A hand-driven `scheduleFrame`/`cancelFrame` pair, in the shape
 * `RenderRuntime`'s own test harness (`render-runtime.test.ts`) uses: the
 * callback is held, not run, until the test fires it with `flush()`, so a
 * burst of calls before the flush is observable as exactly that — a burst,
 * not a sequence of real frames the test would otherwise have to wait for.
 */
function frameScheduler(): {
  scheduleFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  scheduledCount: () => number;
  cancelledCount: () => number;
  /** Runs and clears every callback queued so far. */
  flush: () => void;
} {
  let queue: Array<() => void> = [];
  let scheduledCount = 0;
  let cancelledCount = 0;
  return {
    scheduleFrame: (callback) => {
      queue.push(callback);
      scheduledCount += 1;
      return scheduledCount;
    },
    cancelFrame: () => {
      cancelledCount += 1;
    },
    scheduledCount: () => scheduledCount,
    cancelledCount: () => cancelledCount,
    flush: () => {
      const due = queue;
      queue = [];
      for (const callback of due) callback();
    },
  };
}

function build(
  options?: () => PlanModeOptions,
  scheduler?: { scheduleFrame?: (callback: () => void) => number; cancelFrame?: (handle: number) => void },
  assetFacts?: () => AssetFactsSource,
  watchPixelRatio?: (onChange: () => void, signal: AbortSignal) => void,
): Harness {
  const shell = openShell();
  const perspective = new THREE.PerspectiveCamera(60, 1.5, 0.1, 100);
  const runtime = new RenderRuntime({
    canvas: shell.roots.canvas,
    viewport: shell.roots.viewport,
  });
  runtime.setCamera(perspective);
  const modes = new PlanModes({
    container: shell.roots.root,
    viewport: shell.roots.viewport,
    runtime,
    perspective: () => perspective,
    options,
    scheduleFrame: scheduler?.scheduleFrame,
    cancelFrame: scheduler?.cancelFrame,
    assetFacts,
    watchPixelRatio,
  });
  return { shell, runtime, modes, perspective };
}

let harness: Harness;

beforeEach(() => {
  harness = build();
});

afterEach(() => {
  harness.modes.dispose();
  harness.runtime.dispose();
  closeContainers();
});

describe('the overlay', () => {
  test('is a named canvas in the shell, hidden and aria-hidden to begin with', () => {
    const canvas = harness.modes.element;
    expect(canvas.dataset['jeex']).toBe(OVERLAY_NAMES.planCanvas);
    expect(canvas.dataset['visible']).toBe('false');
    expect(canvas.dataset['view']).toBe('orbit');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(harness.shell.roots.root.contains(canvas)).toBe(true);
  });

  test('dispose takes it out of the shell', () => {
    const canvas = harness.modes.element;
    harness.modes.dispose();
    expect(canvas.isConnected).toBe(false);
  });
});

describe('plan2d', () => {
  test('shows the drawing, stops the renderer, and paints real ink', async () => {
    harness.modes.setDocument(demoPlan(), demoScene());
    harness.modes.setMode('plan2d');
    await until(() => harness.modes.element.width > 0, 'the overlay to get a backing store');
    const canvas = harness.modes.element;
    expect(canvas.dataset['visible']).toBe('true');
    expect(canvas.dataset['view']).toBe('plan2d');
    expect(harness.runtime.isRenderEnabled()).toBe(false);
    expect(canvasHasInk(canvas)).toBe(true);
  });

  test('a document committed while plan2d is on repaints at once', async () => {
    harness.modes.setMode('plan2d');
    await nextFrame();
    expect(canvasHasInk(harness.modes.element)).toBe(false);
    harness.modes.setDocument(demoPlan(), demoScene());
    expect(canvasHasInk(harness.modes.element)).toBe(true);
    expect(harness.modes.planDrawing).not.toBeNull();
  });

  test('leaving plan2d hides the overlay and starts the renderer again', () => {
    harness.modes.setDocument(demoPlan(), demoScene());
    harness.modes.setMode('plan2d');
    harness.modes.setMode('orbit');
    expect(harness.modes.element.dataset['visible']).toBe('false');
    expect(harness.runtime.isRenderEnabled()).toBe(true);
  });
});

describe('plan3d', () => {
  test('installs the orthographic top view and keeps the renderer drawing', () => {
    harness.modes.setDocument(demoPlan(), demoScene());
    harness.modes.setMode('plan3d');
    expect(harness.runtime.isRenderEnabled()).toBe(true);
    expect(harness.modes.activeCamera()).toBe(harness.modes.topCamera);
    // The overlay is the 2D drawing's; 3D is the scene seen from above.
    expect(harness.modes.element.dataset['visible']).toBe('false');
    expect(harness.modes.element.dataset['view']).toBe('plan3d');
  });

  test('the top view is centred on the plan, looks down, and holds the whole of it', () => {
    const plan = demoPlan();
    harness.modes.setDocument(plan, demoScene());
    harness.modes.setMode('plan3d');
    const top = harness.modes.topCamera;
    const bounds = harness.modes.planDrawing!.bounds;
    expect(top.position.x).toBeCloseTo((bounds.min.x + bounds.max.x) / 2, 5);
    expect(top.position.z).toBeCloseTo((bounds.min.z + bounds.max.z) / 2, 5);
    expect(top.position.y).toBeGreaterThan(0);
    expect(top.right - top.left).toBeGreaterThan(bounds.max.x - bounds.min.x);
    expect(top.top - top.bottom).toBeGreaterThan(bounds.max.z - bounds.min.z);
    // Widened to the viewport aspect, so the 6 % padding survives on both axes.
    const aspect = harness.shell.roots.viewport.clientWidth / harness.shell.roots.viewport.clientHeight;
    expect((top.right - top.left) / (top.top - top.bottom)).toBeCloseTo(aspect, 3);
  });

  test('leaving plan3d puts the perspective camera back', () => {
    harness.modes.setDocument(demoPlan(), demoScene());
    harness.modes.setMode('plan3d');
    harness.modes.setMode('walk');
    expect(harness.modes.activeCamera()).toBe(harness.perspective);
  });
});

describe('viewPose: where a walk or tour entry glides from', () => {
  test('in both plan modes the stand-in lands the floor where the top view and the drawing show it; none outside them', () => {
    const plan = demoPlan();
    harness.modes.setDocument(plan, demoScene());
    const viewport = harness.shell.roots.viewport;
    harness.perspective.aspect = viewport.clientWidth / viewport.clientHeight;
    harness.perspective.updateProjectionMatrix();
    expect(harness.modes.viewPose()).toBeNull();
    const bounds = harness.modes.planDrawing!.bounds;
    for (const mode of ['plan3d', 'plan2d'] as const) {
      harness.modes.setMode(mode);
      const pose = harness.modes.viewPose()!;
      const camera = new THREE.PerspectiveCamera(
        fieldOfViewFor(harness.perspective.aspect, pose.position.y),
        harness.perspective.aspect,
        0.1,
        200,
      );
      camera.position.copy(pose.position);
      camera.lookAt(pose.target);
      camera.updateMatrixWorld();
      const top = harness.modes.topCamera;
      for (const [x, z] of [
        [bounds.min.x, bounds.min.z],
        [bounds.max.x, bounds.max.z],
        [(bounds.min.x + bounds.max.x) / 2, bounds.min.z],
      ] as const) {
        const seen = new THREE.Vector3(x, 0, z).project(camera);
        const shown = new THREE.Vector3(x, 0, z).project(top);
        expect(Math.hypot(seen.x - shown.x, seen.y - shown.y)).toBeLessThan(0.02);
      }
    }
    harness.modes.setMode('walk');
    expect(harness.modes.viewPose()).toBeNull();
  });
});

describe('the three camera modes', () => {
  test('leave the overlay hidden and the renderer running', () => {
    harness.modes.setDocument(demoPlan(), demoScene());
    for (const mode of ['orbit', 'walk', 'tour'] as const) {
      harness.modes.setMode(mode);
      expect(harness.modes.element.dataset['visible']).toBe('false');
      expect(harness.runtime.isRenderEnabled()).toBe(true);
      expect(harness.modes.activeCamera()).toBe(harness.perspective);
    }
  });

  test('setMode is idempotent: the same mode twice changes nothing', () => {
    harness.modes.setDocument(demoPlan(), demoScene());
    harness.modes.setMode('plan2d');
    const before = harness.modes.element.toDataURL();
    harness.modes.setMode('plan2d');
    expect(harness.modes.element.toDataURL()).toBe(before);
  });
});

describe('resizing', () => {
  test('the overlay refits to a changed viewport without a window resize', async () => {
    harness.modes.setDocument(demoPlan(), demoScene());
    harness.modes.setMode('plan2d');
    await until(() => harness.modes.element.width > 0, 'the first fit');
    const before = harness.modes.element.width;
    harness.shell.container.style.width = '500px';
    // The ResizeObserver watches the CONTAINER, not the window — the property
    // an embedded viewer depends on.
    await until(() => harness.modes.element.width !== before, 'the overlay to refit');
    expect(harness.modes.element.width).toBeLessThan(before);
  });
});

describe('a pixel-ratio change at a fixed CSS size', () => {
  test('refits and repaints the drawing at the new ratio, with no box change to report it', async () => {
    let changed: (() => void) | null = null;
    const local = build(undefined, undefined, undefined, (onChange) => (changed = onChange));
    local.modes.setDocument(demoPlan(), demoScene());
    local.modes.setMode('plan2d');
    await until(() => local.modes.element.width > 0, 'the first fit');
    const before = local.modes.element.width;
    const ratio = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: ratio * 1.5 });
    try {
      expect(changed).not.toBeNull();
      changed!();
      await until(() => local.modes.element.width !== before, 'the overlay to refit at the new ratio');
      expect(local.modes.element.width).toBe(Math.round(before * 1.5));
    } finally {
      delete (window as { devicePixelRatio?: number }).devicePixelRatio;
      local.modes.dispose();
      local.runtime.dispose();
    }
  });
});

/**
 * Resizing the overlay SYNCHRONOUSLY inside the `ResizeObserver` callback is
 * what raised the browser's "ResizeObserver loop completed with undelivered
 * notifications" again and again during ordinary resizing. These tests drive the RO
 * callback by hand (`onResize`, an instance field and thus reachable at
 * runtime despite the `private` annotation, exactly as `render-runtime.ts`'s
 * own harness drives `onObserve`) against an injected `scheduleFrame` the
 * test holds open, so a burst of notifications is observable as a burst —
 * not something `until()` could tell apart from three real, slow frames.
 */
describe('resize coalescing', () => {
  test('the RO callback schedules once per burst and never fits on its own call stack', () => {
    const scheduler = frameScheduler();
    const local = build(undefined, scheduler);
    local.modes.setDocument(demoPlan(), demoScene());
    local.modes.setMode('plan2d');
    const paintSpy = vi.spyOn(PlanModes.prototype as unknown as { paint: () => void }, 'paint');
    const onResize = (local.modes as unknown as { onResize: () => void }).onResize;

    // A burst of three notifications — width, height and device-pixel-box
    // readings of the same layout pass all land on this one handler.
    onResize();
    onResize();
    onResize();
    expect(scheduler.scheduledCount()).toBe(1);
    expect(paintSpy).not.toHaveBeenCalled();

    scheduler.flush();
    expect(paintSpy).toHaveBeenCalledTimes(1);

    // A later, separate burst schedules again: coalescing resets, it does
    // not latch shut after the first fit.
    onResize();
    onResize();
    expect(scheduler.scheduledCount()).toBe(2);
    scheduler.flush();
    expect(paintSpy).toHaveBeenCalledTimes(2);

    paintSpy.mockRestore();
    local.modes.dispose();
    local.runtime.dispose();
  });

  test('dispose cancels a pending resize handle instead of letting it fit a torn-down overlay', () => {
    const scheduler = frameScheduler();
    const local = build(undefined, scheduler);
    local.modes.setDocument(demoPlan(), demoScene());
    local.modes.setMode('plan2d');
    const onResize = (local.modes as unknown as { onResize: () => void }).onResize;

    onResize();
    expect(scheduler.scheduledCount()).toBe(1);
    expect(scheduler.cancelledCount()).toBe(0);
    local.modes.dispose();
    expect(scheduler.cancelledCount()).toBe(1);

    local.runtime.dispose();
  });
});

describe('plan.labels, plan.dimensions and plan.camera', () => {
  test('with no options wired, plan2d gains one label per room, the facade dimension chains, and the camera marker', async () => {
    harness.modes.setDocument(demoPlan(), demoScene());
    harness.modes.setMode('plan2d');
    await until(() => harness.modes.element.width > 0, 'the overlay to get a backing store');
    const drawing = harness.modes.planDrawing!;
    expect(drawing.primitives.filter((p) => p.kind === 'label').length).toBe(demoPlan().rooms.length);
    expect(drawing.primitives.some((p) => p.kind === 'dimension')).toBe(true);
    expect(hasAccentPixel(harness.modes.element)).toBe(true);
  });

  test('plan.labels=false drops the label primitives but keeps the dimensions', async () => {
    const local = build(() => ({ labels: false, dimensions: true, camera: true }));
    local.modes.setDocument(demoPlan(), demoScene());
    local.modes.setMode('plan2d');
    await until(() => local.modes.element.width > 0, 'the overlay to get a backing store');
    const drawing = local.modes.planDrawing!;
    expect(drawing.primitives.some((p) => p.kind === 'label')).toBe(false);
    expect(drawing.primitives.some((p) => p.kind === 'dimension')).toBe(true);
    local.modes.dispose();
    local.runtime.dispose();
  });

  test('plan.dimensions=false drops the dimension primitives but keeps the labels', async () => {
    const local = build(() => ({ labels: true, dimensions: false, camera: true }));
    local.modes.setDocument(demoPlan(), demoScene());
    local.modes.setMode('plan2d');
    await until(() => local.modes.element.width > 0, 'the overlay to get a backing store');
    const drawing = local.modes.planDrawing!;
    expect(drawing.primitives.some((p) => p.kind === 'label')).toBe(true);
    expect(drawing.primitives.some((p) => p.kind === 'dimension')).toBe(false);
    local.modes.dispose();
    local.runtime.dispose();
  });

  test('plan.camera=false paints no camera marker', async () => {
    const local = build(() => ({ labels: true, dimensions: true, camera: false }));
    local.modes.setDocument(demoPlan(), demoScene());
    local.modes.setMode('plan2d');
    await until(() => local.modes.element.width > 0, 'the overlay to get a backing store');
    expect(hasAccentPixel(local.modes.element)).toBe(false);
    local.modes.dispose();
    local.runtime.dispose();
  });
});

describe('fixtures come from the document’s own bank', () => {
  test('the store-id flat drawn with its library outlines its nine bath and kitchen fixtures', () => {
    const scene = { ...demoScene(), assets: STORE_IDS.assets };
    const facts = projectAssetFacts(STORE_IDS.library);
    const local = build(undefined, undefined, () => facts);
    local.modes.setDocument(demoPlan(), scene);
    const fixtures = local.modes.planDrawing!.primitives.filter((primitive) => primitive.kind === 'fixture');
    expect(fixtures).toHaveLength(9);
    // The same document through the shipped bank alone: nothing it knows.
    harness.modes.setDocument(demoPlan(), scene);
    expect(harness.modes.planDrawing!.primitives.filter((primitive) => primitive.kind === 'fixture')).toHaveLength(0);
    local.modes.dispose();
    local.runtime.dispose();
  });
});
