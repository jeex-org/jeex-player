/**
 * The test doubles more than one suite needs, in one place.
 *
 * They replace duplicated test doubles: `harness` in five test files, `build`
 * in five, `rig` in three, `fakeCanvas` in two, plus a `Picker`, a
 * `CameraDirector`, a `ViewerEditor` and a `SceneBuilder` stub built twice,
 * differently, with an `as unknown as` cast each time.
 *
 * The point is not fewer lines. It is that a stub is a CLAIM about the shape of
 * the real thing, and a claim written in four places drifts in three of them:
 * when `Picker` grows a method, one file's stub is updated and the others go on
 * asserting against an interface that no longer exists. There is one claim per
 * collaborator here, and one `as unknown as` behind it.
 *
 * `src/fixtures/` on purpose: it is already the home of the test data
 * (`plan-l-shape.ts`) and it is unranked by the layer policy, so a stub may
 * name any layer's type without inverting the order.
 */

import * as THREE from 'three';
import { createLightingContext, type LightingContext } from '../lighting/lighting-context.js';
import type { LightingThree } from '../lighting/lighting-three.js';
import type { CameraDirector } from '../camera/camera-director.js';
import type { Picker } from '../geometry/picker.js';
import type { SceneBuilder } from '../geometry/scene-builder.js';
import type { ViewerEditor } from '../app/viewer-editor.js';
import type { ApplyResult } from '../scene/scene-model.js';
import type { Draft } from '../shared/committed.js';
import { createLogger, type LogEntry, type Logger, type LogSink } from '../shared/logger.js';

type Listener = (event: unknown) => void;

export type FakeCanvas = {
  /** Every handler registered, by type: what `fire` dispatches to. */
  readonly listeners: Map<string, Set<Listener>>;
  clientWidth: number;
  clientHeight: number;
  style: Record<string, string>;
  /** `data-*` attributes; `camera-input.ts` marks the move modifier and a drag here for the cursor. */
  dataset: Record<string, string>;
  /** Pointer ids `setPointerCapture` was given, oldest first. */
  readonly captured: number[];
  /**
   * The `passive` option the LAST `addEventListener(type, …)` call for that
   * type carried, `undefined` for a type nothing has registered
   * (`camera-input.ts`'s `interaction: 'passive'` wheel listener).
   */
  readonly passive: Map<string, boolean>;
  addEventListener(type: string, handler: Listener, options?: { signal?: AbortSignal; passive?: boolean }): void;
  removeEventListener(type: string, handler: Listener): void;
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
    x: number;
    y: number;
  };
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  /** Delivers one event to whatever is listening for that type. */
  fire(type: string, event: unknown): void;
  /** How many handlers are registered for a type; `0` for none. */
  count(type: string): number;
};

/**
 * The whole DOM surface `CameraController`, `CameraInput` and `Picker` touch on
 * their canvas — and nothing else.
 *
 * Deliberately not a `HTMLCanvasElement`: a stub that claims to be one would
 * have to answer for two hundred members none of this code calls, and the
 * single cast at each call site is more honest than a partial that pretends.
 * `fire` is here rather than in each suite because delivering an event to the
 * canvas is how every input test starts.
 */
export function fakeCanvas(size: { width: number; height: number } = { width: 800, height: 600 }): FakeCanvas {
  const listeners = new Map<string, Set<Listener>>();
  const captured: number[] = [];
  const passive = new Map<string, boolean>();
  return {
    listeners,
    clientWidth: size.width,
    clientHeight: size.height,
    style: {},
    dataset: {},
    captured,
    passive,
    /**
     * Honours `{ signal }` exactly as the platform does: aborting the signal
     * unbinds the handler. Every listener in `src/` is bound that way and none
     * is paired with a `removeEventListener` (`shared/abort.ts`), so a fake
     * that ignored the option would report handlers a real browser had already
     * dropped — and the disposal tests would pass on a leak.
     */
    addEventListener(type: string, handler: Listener, options?: { signal?: AbortSignal; passive?: boolean }): void {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(handler);
      listeners.set(type, set);
      if (options?.passive !== undefined) passive.set(type, options.passive);
      // listener-policy: allow fake-canvas-abort-bookkeeping
      options?.signal?.addEventListener('abort', () => set.delete(handler), { once: true });
    },
    removeEventListener(type: string, handler: Listener): void {
      listeners.get(type)?.delete(handler);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height, x: 0, y: 0 };
    },
    setPointerCapture(pointerId: number): void {
      captured.push(pointerId);
    },
    releasePointerCapture(): void {
      // Nothing to release without a real canvas; the listener on the element
      // is what keeps a drag alive here.
    },
    fire(type: string, event: unknown): void {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    },
    count(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/**
 * Delivers an event the way the browser now does: to the CANVAS.
 *
 * Keys are not listened for on `window`, where every viewer on a page would walk
 * on one keypress. They go to the focusable shell root instead — resolved by
 * `app/viewer-stage.ts`, which owns `ViewerRoots`, and passed into
 * `CameraController` as `keys` — and a canvas that is not inside one, every
 * harness in the suite, passes itself as its own key target.
 */
export function keysOf(canvas: FakeCanvas): (type: string, event: unknown) => void {
  return (type, event) => canvas.fire(type, event);
}

/**
 * A `Picker` that finds nothing, plus whatever the caller wants it to find.
 *
 * The default is "nothing under the pointer", because that is the case almost
 * every test is about: a rig must behave when the ray misses.
 */
export function stubPicker(overrides: Partial<Picker> = {}): Picker {
  return {
    pickSurface: () => null,
    floorPoint: () => null,
    pickFurniture: () => null,
    ...overrides,
  } as unknown as Picker;
}

export type StubRendererCalls = {
  renders: number;
  disposed: number;
  sizes: Array<{ width: number; height: number }>;
  pixelRatio: number;
};

/**
 * A `THREE.WebGLRenderer` that counts what it was asked to do.
 *
 * Bun has no WebGL context, so the renderer is the one collaborator of
 * `RenderRuntime` that must be injected (`RenderRuntimeOptions.createRenderer`
 * is the seam). The counters are the assertions: how many frames were drawn,
 * how many times it was resized, whether it was disposed exactly once.
 */
export function stubRuntime(): { renderer: THREE.WebGLRenderer; calls: StubRendererCalls } {
  const calls: StubRendererCalls = { renders: 0, disposed: 0, sizes: [], pixelRatio: 0 };
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8, maxTextureSize: 16_384 },
    shadowMap: { enabled: false, type: 0 },
    outputColorSpace: '',
    toneMapping: 0,
    toneMappingExposure: 0,
    setPixelRatio(value: number) {
      calls.pixelRatio = value;
    },
    setSize(width: number, height: number) {
      calls.sizes.push({ width, height });
    },
    render() {
      calls.renders += 1;
    },
    getRenderTarget: () => null,
    setRenderTarget: () => undefined,
    dispose() {
      calls.disposed += 1;
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, calls };
}

/**
 * The lighting standard over a renderer with no GPU: the real context and
 * rigs, built with the real three.js classes, but a `PMREMGenerator` that
 * answers a plain render target instead of prefiltering on a WebGL context
 * Bun does not have. `RenderRuntimeOptions.createLighting` is the seam.
 */
export function stubLighting(renderer: THREE.WebGLRenderer): LightingContext {
  class StubGenerator {
    fromEquirectangular(source: THREE.DataTexture): THREE.WebGLRenderTarget {
      return new THREE.WebGLRenderTarget(source.image.width / 4, source.image.width / 4);
    }
    dispose(): void {}
  }
  return createLightingContext(
    { ...(THREE as unknown as LightingThree), PMREMGenerator: StubGenerator as unknown as LightingThree['PMREMGenerator'] },
    renderer,
  );
}

/** The controller half of a `CameraDirector`, answering "no" to everything. */
export function stubController(overrides: Partial<CameraDirector['controller']> = {}): CameraDirector['controller'] {
  return {
    getMode: () => 'orbit',
    isTravelling: () => false,
    finishTravel: () => false,
    debugFloorPoint: () => null,
    isNavigableAt: () => false,
    canWalkTo: () => false,
    ...overrides,
  } as unknown as CameraDirector['controller'];
}

/** A `CameraDirector` that goes nowhere; give it a `controller` to change that. */
export function stubDirector(
  overrides: { controller?: CameraDirector['controller']; focusRoom?: (roomId: string) => boolean } = {},
): CameraDirector {
  return {
    controller: overrides.controller ?? stubController(),
    focusRoom: overrides.focusRoom ?? (() => false),
  } as unknown as CameraDirector;
}

/** A `SceneBuilder` with an empty scene: no openings, no faces. */
export function stubBuilder(
  overrides: Partial<{ openingsList: () => ReturnType<SceneBuilder['openingsList']>; facesOfRoom: SceneBuilder['facesOfRoom'] }> = {},
): SceneBuilder {
  return {
    openingsList: () => [],
    facesOfRoom: () => [],
    ...overrides,
  } as unknown as SceneBuilder;
}

/** A `ViewerEditor` with nothing selected and no presets. */
export function stubEditor(
  overrides: Partial<{
    selectedFurniture: () => string | null;
    selectedOpening: () => string | null;
    openingVariantOf: (openingId: string) => string | null;
    presets: () => Array<{ id: string; name: string; active: boolean }>;
    applyPreset: (presetId: string) => ApplyResult;
  }> = {},
): ViewerEditor {
  return {
    selectedFurniture: () => null,
    selectedOpening: () => null,
    openingVariantOf: () => null,
    presets: () => [],
    applyPreset: () => ({ error: 'validation_failed', message: 'stub' }),
    ...overrides,
  } as unknown as ViewerEditor;
}

/**
 * Gives Bun a `window` that answers `addEventListener` for the length of a
 * suite, and puts back whatever was there.
 *
 * Several modules probe for a window before deciding what to do
 * (`viewport-box.devicePixelRatioOf`). Under `bun test` there is none, so
 * the probe takes the "no window" branch and the test measures the wrong
 * path. Returns the pair to call from `beforeEach` and `afterEach`.
 */
export function fakeWindowHooks(): { install: () => void; restore: () => void } {
  let hadWindow = false;
  let previous: unknown;
  return {
    install(): void {
      hadWindow = 'window' in globalThis;
      previous = Reflect.get(globalThis, 'window');
      if (hadWindow) return;
      Reflect.set(globalThis, 'window', {
        addEventListener(): void {
          // Nothing listens on `window` any more; the stub exists so the
          // capability probe answers "yes, there is a window".
        },
        removeEventListener(): void {
          // Idem.
        },
      });
    },
    restore(): void {
      if (hadWindow) Reflect.set(globalThis, 'window', previous);
      else Reflect.deleteProperty(globalThis, 'window');
    },
  };
}

/**
 * A `LogSink` that keeps every entry, for a test that wants to read what the
 * viewer said.
 *
 * No test patches `console`: a patch restored in a bare `afterEach` leaks into
 * the next FILE when a test throws. There is nothing to restore here:
 * the sink is INJECTED (`ViewerOptions.onLog`, a `Logger` parameter), so a
 * throwing test leaks nothing at all.
 */
export function collectLog(): { sink: LogSink; entries: LogEntry[]; messages: () => string[]; codes: () => string[]; clear: () => void } {
  const entries: LogEntry[] = [];
  return {
    entries,
    sink: (entry) => {
      entries.push(entry);
    },
    messages: () => entries.map((entry) => entry.message),
    codes: () => entries.map((entry) => entry.code),
    clear: () => {
      entries.length = 0;
    },
  };
}

/** `collectLog` as a `Logger`, for the modules that take one directly. */
export function collectLogger(): { log: Logger; entries: LogEntry[]; messages: () => string[]; codes: () => string[]; clear: () => void } {
  const collected = collectLog();
  return { ...collected, log: createLogger(collected.sink) };
}

/**
 * The committed value, typed as a `Draft` — WITHOUT copying it.
 *
 * The only legitimate use is the freeze tests: `Committed<T>` stops a write at
 * compile time, but a JavaScript host has no types at all, so the runtime deep
 * freeze still has to stop the same write. This is how that host sees the
 * object, and the assertion is that the write throws. Anything that genuinely
 * wants to EDIT committed state calls `draftOf`, which copies.
 */
export function asDraft<T>(value: T): Draft<T> {
  return value as Draft<T>;
}
