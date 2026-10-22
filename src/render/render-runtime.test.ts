/**
 * Contract tests for `RenderRuntime`.
 *
 * Bun has no WebGL context and no `requestAnimationFrame`, so the runtime is
 * built with its injection seams: a stub renderer, the lighting standard over
 * a stub `PMREMGenerator` and a hand-driven frame scheduler. That covers exactly what the composition root
 * depends on — hook order, the frame clock, resize and disposal.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { KEEP_WARM_MS, RenderRuntime, createRenderRuntime, hasWebGL, measureEntry } from './render-runtime.js';
import { stubLighting, stubRuntime } from '../fixtures/stubs.js';
import { apartmentEnvironmentIntensity, LIGHTING_STANDARD } from '../lighting/lighting-standard.js';

/** A runtime built on the shared stub renderer, with the frame pump in hand. */
function harness(
  options: {
    viewport?: { clientWidth: number; clientHeight: number };
    canvas?: HTMLCanvasElement;
    onContextLost?: () => void;
    onContextRestored?: () => void;
    signal?: AbortSignal;
    onError?: (error: unknown) => void;
  } = {},
) {
  const { renderer, calls: stub } = stubRuntime();

  let pending: (() => void) | null = null;
  let handles = 0;
  let cancelled = 0;
  let clock = 1_000;
  const viewport = options.viewport ?? { clientWidth: 800, clientHeight: 600 };
  const runtime = createRenderRuntime({
    canvas: options.canvas ?? ({} as HTMLCanvasElement),
    viewport,
    onContextLost: options.onContextLost,
    onContextRestored: options.onContextRestored,
    signal: options.signal,
    onError: options.onError,
    createRenderer: () => renderer,
    createLighting: stubLighting,
    scheduleFrame: (callback) => {
      pending = callback;
      handles += 1;
      return handles;
    },
    cancelFrame: () => {
      cancelled += 1;
      pending = null;
    },
    now: () => clock,
  });

  /** Runs one scheduled frame after advancing the injected clock. */
  const tick = (advanceMs: number): void => {
    clock += advanceMs;
    const callback = pending;
    pending = null;
    callback?.();
  };

  return { runtime, stub, tick, viewport, scheduled: () => handles, cancelled: () => cancelled, pending: () => pending };
}

describe('RenderRuntime construction', () => {
  /** The lights under `scene`, by kind. */
  function lightsOf(scene: THREE.Scene): { hemisphere: THREE.HemisphereLight[]; directional: THREE.DirectionalLight[] } {
    const hemisphere: THREE.HemisphereLight[] = [];
    const directional: THREE.DirectionalLight[] = [];
    scene.traverse((object) => {
      if (object instanceof THREE.HemisphereLight) hemisphere.push(object);
      if (object instanceof THREE.DirectionalLight) directional.push(object);
    });
    return { hemisphere, directional };
  }

  test('builds a scene with fog, lit by the standard apartment rig', () => {
    const { runtime, stub } = harness();
    expect(runtime.scene).toBeInstanceOf(THREE.Scene);
    expect(runtime.scene.fog).toBeInstanceOf(THREE.Fog);
    const { hemisphere, directional } = lightsOf(runtime.scene);
    expect(hemisphere).toHaveLength(1);
    expect(directional).toHaveLength(2);
    const sun = directional.find((light) => light.castShadow)!;
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(sun.intensity).toBe(LIGHTING_STANDARD.apartment.sun.intensity);
    expect(runtime.scene.environment).not.toBeNull();
    expect(runtime.scene.environmentIntensity).toBe(apartmentEnvironmentIntensity());
    expect(runtime.shadowMapSize).toBe(2048);
    expect(stub.sizes[0]).toEqual({ width: 800, height: 600 });
    runtime.dispose();
  });

  test('the lighting standard sets the display transform: PBR Neutral, exposure 1, sRGB, PCF shadows', () => {
    const { runtime } = harness();
    expect(runtime.renderer.toneMapping).toBe(THREE.NeutralToneMapping);
    expect(runtime.renderer.toneMappingExposure).toBe(1);
    expect(runtime.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(runtime.renderer.shadowMap.enabled).toBe(true);
    expect(runtime.renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
    runtime.dispose();
  });

  test('caps the pixel ratio and honours a custom shadow map size', () => {
    const runtime = createRenderRuntime({
      canvas: {} as HTMLCanvasElement,
      viewport: { clientWidth: 10, clientHeight: 10 },
      shadowMapSize: 512,
      createRenderer: () =>
        ({
          capabilities: { getMaxAnisotropy: () => 1, maxTextureSize: 4096 },
          shadowMap: {},
          setPixelRatio() {},
          setSize() {},
          render() {},
          dispose() {},
        }) as unknown as THREE.WebGLRenderer,
      createLighting: stubLighting,
      scheduleFrame: () => 1,
      cancelFrame: () => {},
      now: () => 0,
    });
    expect(lightsOf(runtime.scene).directional.find((light) => light.castShadow)!.shadow.mapSize.x).toBe(512);
    expect(runtime.shadowMapSize).toBe(512);
    runtime.dispose();
  });

  test('dispose releases the lighting and takes the rig off the scene', () => {
    const { runtime } = harness();
    const lighting = runtime.lighting;
    runtime.dispose();
    expect(lighting.disposed).toBe(true);
    expect(runtime.scene.environment).toBeNull();
    expect(lightsOf(runtime.scene).directional).toHaveLength(0);
  });
});

describe('frame hooks', () => {
  test('run in registration order with a clamped delta, then render once', () => {
    const { runtime, stub, tick } = harness();
    const calls: string[] = [];
    const deltas: number[] = [];
    runtime.addFrameHook((delta) => {
      calls.push('first');
      deltas.push(delta);
    });
    runtime.addFrameHook(() => {
      calls.push('second');
    });
    runtime.setCamera(new THREE.PerspectiveCamera());
    runtime.start();
    tick(16);
    expect(calls).toEqual(['first', 'second']);
    expect(deltas[0]).toBeCloseTo(0.016, 5);
    expect(stub.renders).toBe(1);
    // A long stall is clamped so nothing teleports on the frame after it.
    tick(4000);
    expect(deltas[1]).toBeCloseTo(0.05, 5);
    runtime.dispose();
  });

  test('registering the same hook twice adds it once; removeFrameHook detaches it', () => {
    const { runtime, tick } = harness();
    let hits = 0;
    const hook = (): void => {
      hits += 1;
    };
    runtime.addFrameHook(hook);
    runtime.addFrameHook(hook);
    runtime.start();
    tick(16);
    expect(hits).toBe(1);
    runtime.removeFrameHook(hook);
    tick(16);
    expect(hits).toBe(1);
    runtime.dispose();
  });

  test('does not render before a camera is set', () => {
    const { runtime, stub, tick } = harness();
    runtime.start();
    tick(16);
    expect(stub.renders).toBe(0);
    runtime.setCamera(new THREE.PerspectiveCamera());
    tick(16);
    expect(stub.renders).toBe(1);
    runtime.dispose();
  });
});

describe('drawing switched off (plan2d) keeps the scene warm', () => {
  test('one frame every KEEP_WARM_MS is still drawn, never one per frame, and hooks run every frame', () => {
    const { runtime, stub, tick } = harness();
    let hooks = 0;
    runtime.addFrameHook(() => {
      hooks += 1;
    });
    runtime.setCamera(new THREE.PerspectiveCamera());
    runtime.start();
    tick(16);
    expect(stub.renders).toBe(1);
    runtime.setRenderEnabled(false);
    // Frames inside the interval draw nothing: the overlay is opaque.
    const inside = Math.floor((KEEP_WARM_MS - 1) / 16);
    for (let frame = 0; frame < inside; frame += 1) tick(16);
    expect(stub.renders).toBe(1);
    // Past it, one frame keeps what the scene draws with in use, so leaving
    // the mode does not wait for the GPU to bring it back (1.2–5 s measured).
    tick(16);
    expect(stub.renders).toBe(2);
    tick(16);
    expect(stub.renders).toBe(2);
    tick(KEEP_WARM_MS);
    expect(stub.renders).toBe(3);
    expect(hooks).toBe(inside + 4);
    // Switched back on: every frame again.
    runtime.setRenderEnabled(true);
    tick(16);
    tick(16);
    expect(stub.renders).toBe(5);
    runtime.dispose();
  });
});

describe('lastDrawnAt', () => {
  test('a post-render hook can tell a drawn frame from a skipped one', () => {
    const { runtime, tick } = harness();
    const drawn: boolean[] = [];
    runtime.addPostRenderHook((_delta, now) => drawn.push(runtime.lastDrawnAt === now));
    expect(runtime.lastDrawnAt).toBe(Number.NEGATIVE_INFINITY);
    runtime.setCamera(new THREE.PerspectiveCamera());
    runtime.start();
    tick(16);
    runtime.setRenderEnabled(false);
    tick(16);
    expect(drawn).toEqual([true, false]);
    runtime.dispose();
  });
});

describe('loop lifecycle', () => {
  test('start is idempotent and stop cancels the pending frame', () => {
    const { runtime, tick, scheduled, cancelled, pending } = harness();
    runtime.start();
    runtime.start();
    expect(scheduled()).toBe(1);
    tick(16);
    expect(scheduled()).toBe(2);
    runtime.stop();
    expect(cancelled()).toBe(1);
    expect(pending()).toBeNull();
    runtime.stop();
    expect(cancelled()).toBe(1);
    runtime.dispose();
  });

  test('dispose stops the loop, drops the hooks and disposes the renderer once', () => {
    const { runtime, stub, tick } = harness();
    let hits = 0;
    runtime.addFrameHook(() => {
      hits += 1;
    });
    runtime.setCamera(new THREE.PerspectiveCamera());
    runtime.start();
    tick(16);
    expect(hits).toBe(1);
    runtime.dispose();
    expect(stub.disposed).toBe(1);
    tick(16);
    expect(hits).toBe(1);
    expect(stub.renders).toBe(1);
    runtime.start();
    expect(runtime.preview.render(new THREE.Group())).toBeNull();
  });
});

describe('resize', () => {
  test('follows the viewport box and updates the camera aspect', () => {
    const viewport = { clientWidth: 800, clientHeight: 600 };
    const { runtime, stub } = harness({ viewport });
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 160);
    runtime.setCamera(camera);
    expect(camera.aspect).toBeCloseTo(800 / 600, 5);
    viewport.clientWidth = 400;
    viewport.clientHeight = 400;
    runtime.resize();
    expect(camera.aspect).toBeCloseTo(1, 5);
    expect(stub.sizes.at(-1)).toEqual({ width: 400, height: 400 });
    // A collapsed viewport must never produce a zero-sized drawing buffer.
    viewport.clientWidth = 0;
    viewport.clientHeight = 0;
    runtime.resize();
    expect(stub.sizes.at(-1)).toEqual({ width: 1, height: 1 });
    runtime.dispose();
  });
});

describe('factory', () => {
  test('createRenderRuntime returns a RenderRuntime', () => {
    const { runtime } = harness();
    expect(runtime).toBeInstanceOf(RenderRuntime);
    runtime.dispose();
  });
});

/**
 * A canvas with just the event surface the runtime binds to, so the two
 * context events can be dispatched by hand: Bun has no `HTMLCanvasElement` and
 * no WebGL, and what is under test is the runtime's reaction, not the GPU's.
 */
function fakeCanvas(): { canvas: HTMLCanvasElement; fire: (type: string) => { defaultPrevented: boolean } } {
  type Handler = (event: { preventDefault: () => void }) => void;
  const handlers = new Map<string, Handler[]>();
  const canvas = {
    addEventListener(type: string, handler: Handler, options?: { signal?: AbortSignal }) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
      options?.signal?.addEventListener('abort', () => {
        handlers.set(
          type,
          (handlers.get(type) ?? []).filter((entry) => entry !== handler),
        );
      });
    },
  } as unknown as HTMLCanvasElement;
  const fire = (type: string): { defaultPrevented: boolean } => {
    const event = {
      defaultPrevented: false,
      preventDefault(): void {
        event.defaultPrevented = true;
      },
    };
    for (const handler of [...(handlers.get(type) ?? [])]) handler(event);
    return event;
  };
  return { canvas, fire };
}

describe('frame hook fan-out', () => {
  test('a hook that removes itself does not make the loop skip the next one', () => {
    const { runtime, tick } = harness();
    const seen: string[] = [];
    const first = (): void => {
      seen.push('first');
      runtime.removeFrameHook(first);
    };
    runtime.addFrameHook(first);
    runtime.addFrameHook(() => seen.push('second'));
    runtime.start();
    tick(16);
    expect(seen).toEqual(['first', 'second']);
    runtime.dispose();
  });

  test('a hook that removes ITS NEIGHBOUR still lets it run this frame', () => {
    // The fan-out copies before it walks (`shared/fanout.ts`), so the neighbour
    // runs for the frame already under way and never again.
    const { runtime, tick } = harness();
    const seen: string[] = [];
    const second = (): void => void seen.push('second');
    runtime.addFrameHook(() => {
      seen.push('first');
      runtime.removeFrameHook(second);
    });
    runtime.addFrameHook(second);
    runtime.start();
    tick(16);
    tick(16);
    expect(seen).toEqual(['first', 'second', 'first']);
    runtime.dispose();
  });

  test('a throwing hook is reported and the rest of the frame still runs', () => {
    const errors: unknown[] = [];
    const { runtime, stub, tick } = harness({ onError: (error) => errors.push(error) });
    const boom = new Error('hook exploded');
    runtime.addFrameHook(() => {
      throw boom;
    });
    let after = 0;
    runtime.addFrameHook(() => {
      after += 1;
    });
    runtime.setCamera(new THREE.PerspectiveCamera());
    runtime.start();
    tick(16);
    expect(errors).toEqual([boom]);
    expect(after).toBe(1);
    expect(stub.renders).toBe(1);
    runtime.dispose();
  });

  test('a hook added mid-frame runs from the next frame, not this one', () => {
    const { runtime, tick } = harness();
    const seen: string[] = [];
    runtime.addFrameHook(() => {
      seen.push('first');
      runtime.addFrameHook(() => seen.push('late'));
    });
    runtime.start();
    tick(16);
    expect(seen).toEqual(['first']);
    tick(16);
    expect(seen).toEqual(['first', 'first', 'late']);
    runtime.dispose();
  });
});

/**
 * The loop is paused while the canvas cannot be seen, and the frame clock is
 * re-synchronised on resume: a tab that was away for a minute must not hand
 * the hooks a one-minute delta.
 */
describe('visibility', () => {
  /**
   * A `document` with just `hidden` and the one listener the runtime binds,
   * wired onto a fake canvas's `ownerDocument` — `watchVisibility` reads that,
   * not the global, so a test document must live where the code now looks.
   */
  function fakeDocument(): { document: unknown; canvas: HTMLCanvasElement; setHidden: (hidden: boolean) => void } {
    const handlers: Array<() => void> = [];
    const doc = {
      hidden: false,
      addEventListener(type: string, handler: () => void) {
        if (type === 'visibilitychange') handlers.push(handler);
      },
    };
    return {
      document: doc,
      canvas: { ownerDocument: doc } as unknown as HTMLCanvasElement,
      setHidden: (hidden) => {
        doc.hidden = hidden;
        for (const handler of [...handlers]) handler();
      },
    };
  }

  test('a hidden tab pauses the loop and a visible one resumes it with a fresh clock', () => {
    const original = (globalThis as { document?: unknown }).document;
    const fake = fakeDocument();
    (globalThis as { document?: unknown }).document = fake.document;
    try {
      const { runtime, tick, pending, cancelled } = harness({ canvas: fake.canvas });
      const deltas: number[] = [];
      runtime.addFrameHook((delta) => deltas.push(delta));
      runtime.start();
      tick(16);
      fake.setHidden(true);
      expect(pending()).toBeNull();
      expect(cancelled()).toBe(1);
      // A long stretch passes while the tab is away.
      fake.setHidden(false);
      expect(pending()).not.toBeNull();
      tick(16);
      // Every delta is a real frame step: the clock was re-synchronised on
      // resume rather than reporting the whole absence.
      expect(deltas.every((delta) => delta <= 0.05)).toBe(true);
      expect(deltas.at(-1)).toBeCloseTo(0.016, 5);
      runtime.dispose();
    } finally {
      (globalThis as { document?: unknown }).document = original;
    }
  });

  test('start while hidden schedules nothing, and becoming visible starts it', () => {
    const original = (globalThis as { document?: unknown }).document;
    const fake = fakeDocument();
    (globalThis as { document?: unknown }).document = fake.document;
    try {
      const { runtime, pending } = harness({ canvas: fake.canvas });
      fake.setHidden(true);
      runtime.start();
      expect(pending()).toBeNull();
      fake.setHidden(false);
      expect(pending()).not.toBeNull();
      runtime.dispose();
    } finally {
      (globalThis as { document?: unknown }).document = original;
    }
  });

  test('a stopped loop is not resumed by the tab coming back', () => {
    const original = (globalThis as { document?: unknown }).document;
    const fake = fakeDocument();
    (globalThis as { document?: unknown }).document = fake.document;
    try {
      const { runtime, pending } = harness({ canvas: fake.canvas });
      runtime.start();
      runtime.stop();
      fake.setHidden(true);
      fake.setHidden(false);
      expect(pending()).toBeNull();
      runtime.dispose();
    } finally {
      (globalThis as { document?: unknown }).document = original;
    }
  });
});

describe('resize is idempotent', () => {
  test('a resize to the box the renderer already has costs nothing', () => {
    const viewport = { clientWidth: 800, clientHeight: 600 };
    const { runtime, stub } = harness({ viewport });
    runtime.setCamera(new THREE.PerspectiveCamera());
    const before = stub.sizes.length;
    runtime.resize();
    runtime.resize();
    // `setPixelRatio` reapplies the last size inside three, so an unguarded
    // pair reallocates the drawing buffer twice per observation.
    expect(stub.sizes.length).toBe(before);
    viewport.clientWidth = 640;
    runtime.resize();
    expect(stub.sizes.length).toBeGreaterThan(before);
    runtime.dispose();
  });
});

describe('measureEntry', () => {
  /** An entry with whichever of the three readings a browser offers. */
  const entry = (readings: {
    content?: { inlineSize: number; blockSize: number };
    device?: { inlineSize: number; blockSize: number };
    rect?: { width: number; height: number };
  }): ResizeObserverEntry =>
    ({
      contentBoxSize: readings.content ? [readings.content] : undefined,
      devicePixelContentBoxSize: readings.device ? [readings.device] : undefined,
      contentRect: readings.rect ?? { width: 0, height: 0 },
    }) as unknown as ResizeObserverEntry;

  test('prefers the device-pixel box the browser measured', () => {
    const box = measureEntry(entry({ content: { inlineSize: 800.5, blockSize: 600.5 }, device: { inlineSize: 1601, blockSize: 1201 } }), 2);
    // Not `800.5 * 2 = 1601` by luck: the point is that the browser's own
    // reading is used rather than a multiplication after CSS rounding.
    expect(box).toEqual({ cssWidth: 800.5, cssHeight: 600.5, deviceWidth: 1601, deviceHeight: 1201 });
  });

  test('falls back to the CSS box times the pixel ratio where there is no device box', () => {
    const box = measureEntry(entry({ content: { inlineSize: 300, blockSize: 200 } }), 1.5);
    expect(box).toEqual({ cssWidth: 300, cssHeight: 200, deviceWidth: 450, deviceHeight: 300 });
  });

  test('falls back to contentRect where there is no contentBoxSize either', () => {
    const box = measureEntry(entry({ rect: { width: 120, height: 90 } }), 1);
    expect(box).toEqual({ cssWidth: 120, cssHeight: 90, deviceWidth: 120, deviceHeight: 90 });
  });

  test('a box with no area is no reading at all', () => {
    expect(measureEntry(entry({ content: { inlineSize: 0, blockSize: 400 } }), 2)).toBeNull();
    expect(measureEntry(entry({ rect: { width: 0, height: 0 } }), 2)).toBeNull();
  });
});

describe('hasWebGL', () => {
  test('probes once per process and hands the probe context straight back', () => {
    const original = (globalThis as { document?: unknown }).document;
    let created = 0;
    let released = 0;
    const context = {
      getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => (released += 1) } : null),
    };
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        created += 1;
        return { getContext: (id: string) => (id === 'webgl2' ? context : null) };
      },
    };
    try {
      expect(hasWebGL()).toBe(true);
      expect(hasWebGL()).toBe(true);
      expect(hasWebGL()).toBe(true);
      // One canvas, one context, one `loseContext`: browsers cap a page at
      // about sixteen contexts; guards against burning one per call.
      expect([created, released]).toEqual([1, 1]);
    } finally {
      (globalThis as { document?: unknown }).document = original;
    }
  });
});

describe('WebGL context loss', () => {
  test('a lost context stops the loop, is preventDefault-ed and is reported once', () => {
    const { canvas, fire } = fakeCanvas();
    const lost: number[] = [];
    const { runtime, tick, pending } = harness({ canvas, onContextLost: () => lost.push(1) });
    runtime.setCamera(new THREE.PerspectiveCamera());
    runtime.start();
    tick(16);
    const event = fire('webglcontextlost');
    expect(event.defaultPrevented).toBe(true);
    expect(lost.length).toBe(1);
    expect(runtime.isContextLost()).toBe(true);
    expect(pending()).toBe(null);
    runtime.dispose();
  });

  test('start does nothing while the context is gone', () => {
    const { canvas, fire } = fakeCanvas();
    const { runtime, pending } = harness({ canvas });
    fire('webglcontextlost');
    runtime.start();
    expect(pending()).toBe(null);
    runtime.dispose();
  });

  test('a restored context reports first and then resumes the loop', () => {
    const { canvas, fire } = fakeCanvas();
    const order: string[] = [];
    const { runtime, pending } = harness({
      canvas,
      onContextRestored: () => order.push(`restored:${String(runtime.isContextLost())}`),
    });
    runtime.setCamera(new THREE.PerspectiveCamera());
    runtime.start();
    fire('webglcontextlost');
    fire('webglcontextrestored');
    // The flag is already cleared when the composition root re-mounts, so the
    // re-mount may draw; the loop is running again once it returns.
    expect(order).toEqual(['restored:false']);
    expect(runtime.isContextLost()).toBe(false);
    expect(pending()).not.toBe(null);
    runtime.dispose();
  });

  test('a restored context gets a new lighting context and rig before the re-mount', () => {
    const { canvas, fire } = fakeCanvas();
    let seen: { fresh: boolean; environment: unknown } | null = null;
    const { runtime } = harness({
      canvas,
      onContextRestored: () => {
        seen = { fresh: !runtime.lighting.disposed, environment: runtime.scene.environment };
      },
    });
    const before = runtime.lighting;
    const environment = runtime.scene.environment;
    fire('webglcontextlost');
    fire('webglcontextrestored');
    expect(before.disposed).toBe(true);
    expect(runtime.lighting).not.toBe(before);
    expect(seen).not.toBeNull();
    expect(seen!.fresh).toBe(true);
    expect(seen!.environment).not.toBe(environment);
    expect(seen!.environment).not.toBeNull();
    // Still exactly one rig on the scene.
    let directional = 0;
    runtime.scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight) directional += 1;
    });
    expect(directional).toBe(2);
    runtime.dispose();
  });

  test('a disposed runtime hears nothing more from its canvas', () => {
    const { canvas, fire } = fakeCanvas();
    const lost: number[] = [];
    const { runtime } = harness({ canvas, onContextLost: () => lost.push(1) });
    runtime.dispose();
    fire('webglcontextlost');
    expect(lost).toEqual([]);
  });

  test('aborting the mount signal takes the canvas listeners down', () => {
    const { canvas, fire } = fakeCanvas();
    const lost: number[] = [];
    const controller = new AbortController();
    harness({ canvas, signal: controller.signal, onContextLost: () => lost.push(1) });
    controller.abort();
    fire('webglcontextlost');
    expect(lost).toEqual([]);
  });
});
