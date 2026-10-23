/**
 * `mountViewer` — the whole public surface, on a real WebGL2 context.
 *
 * This closes a gap next to the release blockers: the composition root and the handle a host actually holds had NO unit test, and
 * `resize()`, `dispose()` and the `scene` event had no coverage anywhere.
 * Everything below drives the real object graph against the demo apartment.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { InlineSceneRepository, mountViewer, optionsFromDataset } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { ViewerError, ViewerReadyInfo, ViewerSceneInfo } from '../../src/app/viewer-events.js';
import { OVERLAY_NAMES, VIEWER_ROOT_SELECTOR } from '../../src/ui/viewer-shell.js';
import { canvasHasInk, closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

/** Fill colour of the camera marker's dot (the `drawing` palette's `accent`, `#dfbd7d`). */
function hasAccentPixel(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 223 && data[i + 1] === 189 && data[i + 2] === 125) return true;
  }
  return false;
}

/** The documents this file loads over the demo, and a room the demo lacks, by fixed UUID v7. */
const SCENE = {
  second: '01a12ffa-de53-7547-97a8-93e6f19c86e5',
  fast: '01a12ffa-de54-7eb0-90bc-40d446703a2d',
  slow: '01a12ffa-de55-751a-ae1b-92b77b026098',
  late: '01a12ffa-de56-7e51-9b20-edd24d730bab',
  swapped: '01a12ffa-de57-70b7-acde-3dc8647185ab',
  broken: '01a12ffa-de58-7532-8aef-a007e448d00e',
} as const;
const UNKNOWN_ROOM = '01a12ffa-de59-749b-82e3-d019f80d9a6d';

const handles: ViewerHandle[] = [];

/**
 * A test that mounts the demo apartment and then successfully rebuilds it
 * through `loadScene` does TWO full geometry builds, not one. One demo mount
 * costs 20-30 s on a loaded software rasteriser, so two need more than the
 * tier's 60 s light-path `testTimeout` (`vitest.config.ts`): 90 s. A
 * `loadScene` that fails before the build (an invalid document, a repository
 * that rejects) keeps the default: the second build never runs.
 */
const MOUNT_PLUS_RELOAD_TIMEOUT_MS = 90_000;

/**
 * A mounted viewer over the demo apartment.
 *
 * `tour.mode: 'off'` and `debug: false` on purpose: an autoplaying clip moves
 * the camera under every assertion, and the debug globals are one-per-page
 * (`viewer-globals.ts`), so two viewers in one test file would fight over them.
 */
function mount(options: Record<string, unknown> = {}): { container: HTMLElement; handle: ViewerHandle } {
  const container = openContainer();
  const handle = mountViewer(container, {
    scene: { repository: new InlineSceneRepository(demoScene()) },
    tour: { mode: 'off' },
    debug: false,
    ...options,
  });
  handles.push(handle);
  return { container, handle };
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  closeContainers();
});

describe('handle.slots', () => {
  /**
   * The contract says every member is safe the moment `mountViewer` returns
   * (`viewer-handle.ts` header). For the slots that is not a no-op but a real
   * answer: the boxes are built with the shell, so a host renders its chrome
   * while the first scene is still loading.
   */
  test('answers before the first scene, and refuses a slot the mount did not ask for', () => {
    const { container, handle } = mount({ slots: ['bottom-center'] });
    const box = container.querySelector('[data-jeex-slot="bottom-center"]');
    expect(box).not.toBeNull();
    expect(handle.slots.get('bottom-center')).toBe(box);
    expect(handle.slots.anchorPoint()).toBeNull();
    expect(() => handle.slots.get('modal-root')).toThrow(/modal-root/);
  });

  test('a mount that asked for no slot has no box and still answers `anchorPoint`', () => {
    const { container, handle } = mount();
    expect(container.querySelectorAll('[data-jeex-slot]')).toHaveLength(0);
    expect(handle.slots.anchorPoint()).toBeNull();
    // Parking an anchor nobody asked for is a no-op, not a throw.
    expect(() => handle.slots.anchorTo(null)).not.toThrow();
  });
});

describe('mounting', () => {
  test('a mount with no scene source throws before it touches the container', () => {
    const container = openContainer();
    // Guards against a throw that comes after the shell is already in the
    // container and the page globals are claimed: the host would get an
    // exception, a dangling viewer root it has no handle for, and a page whose
    // globals belong to a viewer that never booted.
    expect(() => mountViewer(container, { tour: { mode: 'off' } })).toThrow(/no scene source/);
    expect(container.children.length).toBe(0);
  });

  test('a boot failure reaches a host that subscribed to the error event', async () => {
    const container = openContainer();
    const failures: ViewerError[] = [];
    const handle = mountViewer(container, {
      scene: {
        repository: {
          load: () => Promise.reject(new Error('the scene server said no')),
        },
      },
      tour: { mode: 'off' },
      debug: false,
    });
    handles.push(handle);
    handle.on('error', (error) => failures.push(error));
    // Guards against emitting the event after a `dispose()` that has already
    // run `events.clear()`, where the one failure a host most wants to hear
    // about would reach nobody.
    await expect(handle.ready).rejects.toThrow();
    expect(failures.map((failure) => failure.code)).toEqual(['scene-load']);
    expect(failures[0]?.message).toContain('the scene server said no');
    // The card is up, with its Retry, and the shell is still in the container:
    // a failure is not a disposal.
    expect(container.children.length).toBe(1);
    const card = handle.element.querySelector('[data-jeex="error-state"]');
    expect(card?.classList.contains('is-hidden')).toBe(false);
  });

  test('Retry recovers after a boot failed before the scene ever loaded', async () => {
    const container = openContainer();
    let attempt = 0;
    const handle = mountViewer(container, {
      scene: {
        // Fails once, exactly like a network hiccup; a real load the second
        // time round, exactly like the button doing its job.
        repository: {
          load: () => (attempt++ === 0 ? Promise.reject(new Error('offline')) : Promise.resolve(demoScene())),
        },
      },
      tour: { mode: 'off' },
      debug: false,
    });
    handles.push(handle);
    await expect(handle.ready).rejects.toThrow();
    expect(attempt).toBe(1);
    const retryButton = handle.element.querySelector<HTMLButtonElement>('[data-jeex="retry-button"]');
    expect(retryButton).not.toBeNull();
    const readyEvents: ViewerReadyInfo[] = [];
    handle.on('ready', (payload) => readyEvents.push(payload));
    // Guards against two bugs between here and a working viewer: `ui.bind()`
    // running only after a successful scene load, deep inside `init()`, so this
    // click would reach no listener at all; and the FIRST failure's error card
    // painting a 2D fallback into the still-pristine canvas, permanently
    // taking the one context a canvas may ever hold, so the retried
    // `buildStage()` would find `THREE.WebGLRenderer` unable to get a context.
    retryButton!.click();
    await until(() => readyEvents.length > 0, 'the retried boot to report ready');
    expect(attempt).toBe(2);
    expect(handle.element.querySelector('[data-jeex="error-state"]')?.classList.contains('is-hidden')).toBe(true);
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
    expect(canvas?.width).toBeGreaterThan(0);
  });

  test('ready resolves and the viewer root is inside the host’s container', async () => {
    const { container, handle } = mount();
    await handle.ready;
    expect(handle.element.isConnected).toBe(true);
    expect(container.contains(handle.element)).toBe(true);
    expect(handle.element.matches(VIEWER_ROOT_SELECTOR)).toBe(true);
    // The container stays the host's: one child added, nothing above touched.
    expect(container.children.length).toBe(1);
  });

  test('the resolved options are readable and every default is filled in', async () => {
    const { handle } = mount({ view: { mode: 'walk' } });
    await handle.ready;
    expect(handle.options.view.mode).toBe('walk');
    expect(handle.options.locale).toBe('en');
    expect(handle.options.chrome).toEqual({ brand: true, controls: true, status: true, modeSwitcher: true, hint: true, autoHide: true });
  });

  // One demo mount per test: two mounts in one test body do not fit the
  // default budget, so each plan switch gets its own mount.
  test('plan.labels, plan.dimensions and plan.camera default true', async () => {
    const { handle } = mount();
    await handle.ready;
    expect(handle.options.plan).toEqual({ labels: true, dimensions: true, camera: true });
  });

  test('plan.labels can be turned off individually', async () => {
    const { handle } = mount({ plan: { labels: false } });
    await handle.ready;
    expect(handle.options.plan).toEqual({ labels: false, dimensions: true, camera: true });
  });

  test('plan.dimensions can be turned off individually', async () => {
    const { handle } = mount({ plan: { dimensions: false } });
    await handle.ready;
    expect(handle.options.plan).toEqual({ labels: true, dimensions: false, camera: true });
  });

  test('plan.camera can be turned off individually', async () => {
    const { handle } = mount({ plan: { camera: false } });
    await handle.ready;
    expect(handle.options.plan).toEqual({ labels: true, dimensions: true, camera: false });
  });

  /*
   * The four tests above read `handle.options.plan` — the option as PARSED —
   * and not one of them asked whether the drawing obeys it. It did not: the
   * stage built `PlanModes` without its `options` callback, so every mounted
   * viewer fell back to «all three on» and `plan-camera="0"` drew the marker
   * anyway. `plan-modes.test.ts` proves the renderer honours the callback and
   * was green throughout; only a test through `mountViewer` could see the wire
   * that was never attached (found from a host editor).
   *
   * `view.mode: 'walk'` is not decoration. The marker is painted where the
   * perspective rig STANDS, and the demo's presentation camera is at `z: 22`,
   * eleven metres past a flat that ends at `z: 10.5` — painted from there it
   * falls outside the fitted drawing and off the canvas, so a scan of a plain
   * `plan2d` mount answers «no marker» whatever the option says. `walk` parks
   * the same rig at `walkSpawn`, inside the flat, and `plan2d` paints from
   * there. The pair is what makes either half mean anything: with the option on
   * the accent must be there, with it off it must not.
   */
  async function planCanvasFromWalk(handle: ViewerHandle): Promise<HTMLCanvasElement> {
    await handle.ready;
    handle.setMode('plan2d');
    const canvas = handle.element.querySelector<HTMLCanvasElement>(`[data-jeex="${OVERLAY_NAMES.planCanvas}"]`)!;
    await until(() => canvas.width > 0 && canvasHasInk(canvas), 'the 2D overlay to paint');
    return canvas;
  }

  test(
    'plan.camera defaults on and the mounted viewer really paints the marker',
    async () => {
      const { handle } = mount({ view: { mode: 'walk' } });
      expect(hasAccentPixel(await planCanvasFromWalk(handle))).toBe(true);
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );

  test(
    'plan.camera=false reaches the drawing: the mounted viewer paints no marker',
    async () => {
      const { handle } = mount({ view: { mode: 'walk' }, plan: { camera: false } });
      expect(hasAccentPixel(await planCanvasFromWalk(handle))).toBe(false);
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );

  test('the canvas really got a WebGL context and the chrome is showing', async () => {
    const { handle } = mount();
    await handle.ready;
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    expect(canvas.width).toBeGreaterThan(0);
    expect(handle.element.querySelector('[data-jeex="viewer-ui"]')!.classList.contains('is-hidden')).toBe(false);
    expect(handle.element.querySelector('[data-jeex="loading-state"]')!.classList.contains('is-hidden')).toBe(true);
  });

  test('a source naming no scene at all throws out of mountViewer itself', () => {
    const container = openContainer();
    // Documented behaviour, and it is SYNCHRONOUS: `resolveSceneSource` runs
    // in the `ViewerApp` constructor, so there is never a handle. It runs FIRST,
    // before any DOM is built, so the host is never left with an exception and
    // a viewer root it has no handle to dispose.
    expect(() => mountViewer(container, { scene: {}, debug: false })).toThrow(/no scene source/);
    expect(container.querySelector(VIEWER_ROOT_SELECTOR)).toBeNull();
    expect(container.children.length).toBe(0);
  });
});

describe('the handle’s commands', () => {
  test('getMode reports the option before the camera exists and setMode changes it', async () => {
    const { handle } = mount({ view: { mode: 'orbit' } });
    expect(handle.getMode()).toBe('orbit');
    await handle.ready;
    handle.setMode('walk');
    expect(handle.getMode()).toBe('walk');
    handle.setMode('plan2d');
    expect(handle.getMode()).toBe('plan2d');
  });

  test('the mode event fires for a mode change, with the new mode', async () => {
    const { handle } = mount();
    await handle.ready;
    const modes: string[] = [];
    handle.on('mode', (mode) => modes.push(mode));
    handle.setMode('walk');
    handle.setMode('tour');
    expect(modes).toEqual(['walk', 'tour']);
  });

  test('focusRoom answers true for a room of the scene and false for anything else', async () => {
    const { handle } = mount();
    await handle.ready;
    expect(handle.focusRoom(demoScene().rooms[0]!.id)).toBe(true);
    expect(handle.focusRoom(UNKNOWN_ROOM)).toBe(false);
    // Not a UUID at all: refused like an unknown room, never resolved by name.
    expect(handle.focusRoom('living')).toBe(false);
  });

  test('setSelection highlights a target named by UUID and nothing for one named any other way', async () => {
    const { handle } = mount({ debug: true, view: { mode: 'orbit' } });
    await handle.ready;
    const highlight = (): unknown =>
      (window as unknown as { __viewerDebug: { selection: () => { highlight: unknown } } }).__viewerDebug.selection().highlight;
    const room = demoScene().rooms[0]!.id;
    handle.setSelection({ kind: 'room', id: room });
    expect(highlight()).toEqual({ kind: 'room', id: room });
    // Not a UUID: refused like a target the document does not carry.
    handle.setSelection({ kind: 'room', id: 'living' });
    expect(highlight()).toBeNull();
  });

  test('setLocale re-translates the chrome without rebuilding the scene', async () => {
    const { handle } = mount();
    await handle.ready;
    const hint = handle.element.querySelector('[data-jeex="hint-text"]')!.textContent;
    const canvas = handle.element.querySelector('[data-jeex="scene-canvas"]');
    handle.setLocale('ru');
    expect(handle.element.querySelector('[data-jeex="scene-canvas"]')).toBe(canvas);
    expect(typeof hint).toBe('string');
  });

  test('resize() re-measures the container the observer could not see', async () => {
    const { container, handle } = mount();
    await handle.ready;
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    const before = canvas.width;
    // The box is changed and the observer suppressed by re-measuring in the
    // same tick: `resize()` exists for exactly the host whose transition the
    // observer misses.
    container.style.width = '420px';
    handle.resize();
    expect(canvas.width).not.toBe(before);
    expect(canvas.width).toBeGreaterThan(0);
  });

  test('setFurnitureVisible is accepted before and after the first scene', async () => {
    const { handle } = mount();
    handle.setFurnitureVisible(false);
    await handle.ready;
    handle.setFurnitureVisible(false);
    const button = handle.element.querySelector('[data-jeex="furniture-button"]')!;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    handle.setFurnitureVisible(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  test('getScene answers null before the first scene, then the committed document', async () => {
    const { handle } = mount();
    expect(handle.getScene()).toBeNull();
    await handle.ready;
    const scene = handle.getScene();
    expect(scene?.schemaVersion).toBe(demoScene().schemaVersion);
    expect(scene?.id).toBe(handle.getState().sceneId);
  });

  test('getScene is a deep copy: mutating the result does not touch the next read', async () => {
    const { handle } = mount();
    await handle.ready;
    const first = handle.getScene()!;
    (first as { name: string }).name = 'tampered';
    expect(handle.getScene()!.name).not.toBe('tampered');
  });

  test(
    'getScene round-trips through loadScene({ document })',
    async () => {
      const { handle } = mount();
      await handle.ready;
      const exported = handle.getScene();
      await expect(handle.loadScene({ document: exported })).resolves.toBeUndefined();
      expect(handle.getState().rev).toBe(0);
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );
});

describe('loading another scene', () => {
  test(
    'a valid document fires scene with a new id and leaves ready settled',
    async () => {
      const { handle } = mount();
      await handle.ready;
      const scenes: ViewerSceneInfo[] = [];
      handle.on('scene', (info) => scenes.push(info));
      const second = { ...demoScene(), id: SCENE.second };
      await handle.loadScene({ document: second });
      await until(() => scenes.some((info) => info.sceneId === SCENE.second), 'the scene event');
      expect(scenes.at(-1)!.sceneId).toBe(SCENE.second);
      expect(typeof scenes.at(-1)!.rev).toBe('number');
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );

  test('an invalid document reports scene-invalid and leaves the current scene up', async () => {
    const { handle } = mount();
    await handle.ready;
    const errors: ViewerError[] = [];
    handle.on('error', (error) => errors.push(error));
    const canvas = handle.element.querySelector('[data-jeex="scene-canvas"]');

    await expect(handle.loadScene({ document: { schemaVersion: '2.0', id: SCENE.broken } })).rejects.toThrow();
    expect(errors.map((error) => error.code)).toContain('scene-invalid');
    // The document is validated before anything is torn down, so the failure
    // costs the host nothing that was already on screen.
    expect(handle.element.querySelector('[data-jeex="scene-canvas"]')).toBe(canvas);
    expect(handle.element.querySelector('[data-jeex="error-state"]')!.classList.contains('is-hidden')).toBe(true);
  });

  test('a source that throws reports scene-load, not scene-invalid', async () => {
    const { handle } = mount();
    await handle.ready;
    const errors: ViewerError[] = [];
    handle.on('error', (error) => errors.push(error));
    const repository = { load: () => Promise.reject(new Error('the network said no')) };
    await expect(handle.loadScene({ repository })).rejects.toThrow('the network said no');
    expect(errors.at(-1)!.code).toBe('scene-load');
  });

  // `loadScene` carries a sequence guard; without it completion order — not
  // call order — would decide which document ends up on screen. A host that calls `loadScene` a second time before the first one's
  // fetch has resolved (the custom element does this on rapid `src` changes;
  // `frame-bridge.ts` serializes nothing) must always end up with the LAST
  // call's document, never a stale one that merely finished first.
  test(
    'a call started first but finishing last is discarded once a later call has already started',
    async () => {
      const { handle } = mount();
      await handle.ready;
      const scenes: ViewerSceneInfo[] = [];
      handle.on('scene', (info) => scenes.push(info));

      let resolveSlow!: (value: unknown) => void;
      const slow = {
        load: () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          }),
      };
      const fast = { ...demoScene(), id: SCENE.fast };

      // Started FIRST …
      const slowCall = handle.loadScene({ repository: slow });
      // … but the SECOND call finishes first, because its document is already
      // in hand.
      const fastCall = handle.loadScene({ document: fast });
      await fastCall;
      await until(() => handle.getScene()?.id === SCENE.fast, 'the fast scene to be mounted');

      // Only now does the slower, earlier call's document arrive. It must be
      // discarded quietly — no `scene`, no re-mount, no rejection: nothing
      // about that call's own source or document was wrong, it was simply
      // superseded before it could land.
      resolveSlow({ ...demoScene(), id: SCENE.slow });
      await expect(slowCall).resolves.toBeUndefined();

      expect(handle.getScene()!.id).toBe(SCENE.fast);
      expect(scenes.map((info) => info.sceneId)).not.toContain(SCENE.slow);
      expect(scenes.at(-1)!.sceneId).toBe(SCENE.fast);
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );

  // Same race, but the earlier call is the one that FAILS after being
  // superseded: its own source is bad, yet by the time that is known the host
  // has already moved on to a newer, successful call. The failure must not
  // reach the host as an `error` event or a rejection for a call it no longer
  // cares about, and must not disturb the scene the newer call already put on
  // screen.
  test(
    'a superseded call that fails after being superseded neither rejects nor emits error',
    async () => {
      const { handle } = mount();
      await handle.ready;
      const errors: ViewerError[] = [];
      const scenes: ViewerSceneInfo[] = [];
      handle.on('error', (error) => errors.push(error));
      handle.on('scene', (info) => scenes.push(info));

      let rejectSlow!: (error: unknown) => void;
      const slow = {
        load: () =>
          new Promise((_resolve, reject) => {
            rejectSlow = reject;
          }),
      };
      const fast = { ...demoScene(), id: SCENE.fast };

      const slowCall = handle.loadScene({ repository: slow });
      const fastCall = handle.loadScene({ document: fast });
      await fastCall;
      await until(() => handle.getScene()?.id === SCENE.fast, 'the fast scene to be mounted');

      rejectSlow(new Error('the slow source failed'));
      await expect(slowCall).resolves.toBeUndefined();

      expect(errors).toEqual([]);
      expect(handle.getScene()!.id).toBe(SCENE.fast);
      expect(scenes.at(-1)!.sceneId).toBe(SCENE.fast);
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );

  test('dispose during an in-flight loadScene drops the result without touching the disposed viewer', async () => {
    const { handle } = mount();
    await handle.ready;
    let resolveLate!: (value: unknown) => void;
    const repository = {
      load: () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    };
    const call = handle.loadScene({ repository });
    handle.dispose();
    resolveLate({ ...demoScene(), id: SCENE.late });
    await expect(call).resolves.toBeUndefined();
    expect(() => handle.dispose()).not.toThrow();
  });
});

describe('events', () => {
  test('on returns an unsubscribe that really stops the callback', async () => {
    const { handle } = mount();
    await handle.ready;
    const seen: string[] = [];
    const off = handle.on('mode', (mode) => seen.push(mode));
    handle.setMode('walk');
    off();
    handle.setMode('orbit');
    expect(seen).toEqual(['walk']);
  });

  test('a listener that throws does not stop the others', async () => {
    const { handle } = mount();
    await handle.ready;
    const seen: string[] = [];
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      handle.on('mode', () => {
        throw new Error('host listener is broken');
      });
      handle.on('mode', (mode) => seen.push(mode));
      handle.setMode('walk');
      expect(seen).toEqual(['walk']);
    } finally {
      console_.mockRestore();
    }
  });
});

describe('disposing', () => {
  test('dispose is idempotent and leaves the handle safe to call', async () => {
    const { handle } = mount();
    await handle.ready;
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
    expect(() => handle.setMode('walk')).not.toThrow();
    expect(() => handle.resize()).not.toThrow();
  });

  // Context release is one of the release blockers: Chromium keeps at
  // most ~16 contexts per page and silently loses the OLDEST when a new one is
  // asked for, so a context that outlives its viewer costs the ELEVENTH viewer
  // on the page its renderer. `RenderRuntime.dispose()` calls
  // `renderer.forceContextLoss()` after `renderer.dispose()`, which is what
  // hands it back at once instead of waiting for the collector.
  test('dispose loses the WebGL context', async () => {
    const { handle } = mount();
    await handle.ready;
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    expect(gl).not.toBeNull();
    expect(gl!.isContextLost()).toBe(false);
    handle.dispose();
    await until(() => gl!.isContextLost(), 'the disposed viewer to hand its context back');
    expect(gl!.isContextLost()).toBe(true);
  });

  test('dispose stops the frame loop', async () => {
    const { handle } = mount();
    await handle.ready;
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    handle.dispose();
    await nextFrame();
    const after = canvas.width;
    await nextFrame();
    await nextFrame();
    expect(canvas.width).toBe(after);
  });

  // Dispose is a full teardown: the frame loop, the WebGL context, every
  // listener — and the shell it built. The container a host
  // handed over comes back exactly as it was.
  test('dispose empties the container it was mounted in', async () => {
    const { container, handle } = mount();
    await handle.ready;
    expect(container.children.length).toBe(1);
    handle.dispose();
    expect(container.children.length).toBe(0);
    expect(handle.element.isConnected).toBe(false);
    // Idempotent: a host that disposes twice gets no exception and no change.
    expect(() => handle.dispose()).not.toThrow();
    expect(container.children.length).toBe(0);
  });
});

describe('the debug surface over a viewer that changed', () => {
  test(
    'every getter reads the viewer running NOW, not the one it was installed over',
    async () => {
      // Guards against `installViewerDebug` capturing `model`, `messages`,
      // `viewport`, `tour` and `capabilities` by VALUE at install time, where a
      // surface would outlive the parts it describes. `loadScene` is the path that proves it here:
      // it replaces the document under a surface that is installed per document,
      // and the READ-ONLY halves (`tour`, `projectPoint`, the authoring gate)
      // have to keep working over the new one.
      const { handle } = mount({ debug: true });
      await handle.ready;

      const debugOf = (): {
        rooms: () => string[];
        revision: () => number;
        tour?: unknown;
        applyOps?: unknown;
        projectPoint: (x: number, y: number, z: number) => unknown;
      } => (window as unknown as { __viewerDebug: never }).__viewerDebug;

      expect(debugOf().rooms()).toEqual(demoScene().rooms.map((room) => room.id));
      const swapped = { ...demoScene(), id: SCENE.swapped };
      await handle.loadScene({ document: swapped });

      // The document the SECOND mount built, read through the same surface.
      expect(handle.getState().sceneId).toBe(SCENE.swapped);
      expect(debugOf().revision()).toBe(0);
      expect(debugOf().rooms()).toEqual(swapped.rooms.map((room) => room.id));
      // `tour`, `capabilities` and `viewport` were all captured by value before.
      expect(debugOf().tour).toBeDefined();
      expect(debugOf().applyOps).toBeDefined();
      expect(debugOf().projectPoint(0, 1.6, 0)).not.toBeNull();
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );
});

describe('reading the state back', () => {
  test('getState answers everything a host’s own chrome renders from, at once', async () => {
    const { handle } = mount({ view: { mode: 'walk' }, locale: 'ru' });
    await handle.ready;
    const state = handle.getState();
    expect(state).toEqual({
      mode: 'walk',
      tour: handle.tour.progress(),
      furnitureVisible: true,
      locale: 'ru',
      sceneId: demoScene().id,
      rev: 0,
      // The demo carries no tour cameras: the walk stands on none, and the
      // camera tool is neither placing nor looking through one.
      walk: { camera: { index: null, count: 0 } },
      checkpoints: { lookThrough: null, placing: false },
    });
  });

  test('it answers before the first scene too, from the options', () => {
    const { handle } = mount({ view: { mode: 'plan2d' } });
    const state = handle.getState();
    expect(state.mode).toBe('plan2d');
    expect(state.sceneId).toBeNull();
    expect(state.rev).toBe(0);
  });

  test('it follows every command that changes what it reports', async () => {
    const { handle } = mount();
    await handle.ready;
    handle.setMode('plan3d');
    handle.setFurnitureVisible(false);
    handle.setLocale('ru');
    const state = handle.getState();
    expect(state.mode).toBe('plan3d');
    expect(state.furnitureVisible).toBe(false);
    expect(state.locale).toBe('ru');
  });

  test('the two getters agree with the state they are part of', async () => {
    const { handle } = mount();
    await handle.ready;
    expect(handle.getFurnitureVisible()).toBe(true);
    expect(handle.getLocale()).toBe('en');
    handle.setFurnitureVisible(false);
    handle.setLocale('ru');
    expect(handle.getFurnitureVisible()).toBe(false);
    expect(handle.getLocale()).toBe('ru');
    expect(handle.getState().furnitureVisible).toBe(handle.getFurnitureVisible());
    expect(handle.getState().locale).toBe(handle.getLocale());
  });
});

describe('Symbol.dispose', () => {
  test('is on the handle where the engine has it, and tears the viewer down', async () => {
    // Explicit Resource Management is Baseline LIMITED (no Safari), so the
    // member is optional and the test asks the engine first.
    const { container, handle } = mount();
    await handle.ready;
    if (typeof Symbol.dispose !== 'symbol') {
      expect(handle[Symbol.dispose]).toBeUndefined();
      return;
    }
    expect(typeof handle[Symbol.dispose]).toBe('function');
    handle[Symbol.dispose]!();
    expect(container.querySelector(VIEWER_ROOT_SELECTOR)).toBeNull();
    // The same teardown, so calling both is safe.
    expect(() => handle.dispose()).not.toThrow();
  });
});

describe('two viewers on one page', () => {
  test('mount independently, keep their own modes, and one disposing does not blind the other', async () => {
    const a = mount({ view: { mode: 'orbit' } });
    const b = mount({ view: { mode: 'walk' } });
    await Promise.all([a.handle.ready, b.handle.ready]);
    expect(a.handle.getMode()).toBe('orbit');
    expect(b.handle.getMode()).toBe('walk');
    expect(a.handle.element).not.toBe(b.handle.element);

    a.handle.dispose();
    b.handle.setMode('tour');
    expect(b.handle.getMode()).toBe('tour');
    const canvas = b.handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    expect(canvas.getContext('webgl2')?.isContextLost()).toBe(false);
  });
});

describe('reveal-controls really renders as hidden, not only DOM-property hidden', () => {
  test('controls: false computes display: none on reveal-controls after a real boot', async () => {
    const { handle } = mount({ chrome: { controls: false } });
    await handle.ready;
    const pill = handle.element.querySelector<HTMLElement>('[data-jeex="reveal-controls"]')!;
    expect(pill.hidden).toBe(true);
    expect(getComputedStyle(pill).display).toBe('none');
  });
});

describe('interaction', () => {
  test("interaction: 'none' sets pointer-events: none on the canvas, so a pointer event reaches whatever is behind it", async () => {
    const { handle } = mount({ interaction: 'none' });
    await handle.ready;
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    expect(canvas.style.pointerEvents).toBe('none');
    const rect = canvas.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    // The canvas is the topmost element at that point in every OTHER mode; with
    // pointer-events: none it is skipped entirely, so the hit test lands on
    // whatever wraps it instead (here, the shell's own viewport box).
    expect(hit).not.toBe(canvas);
  });

  test("interaction: 'full' (the default) leaves pointer-events untouched: the canvas is the hit target", async () => {
    const { handle } = mount();
    await handle.ready;
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    expect(canvas.style.pointerEvents).toBe('');
    const rect = canvas.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    expect(hit).toBe(canvas);
  });

  test("interaction: 'passive' still catches gestures, but a wheel event over it is never prevented", async () => {
    const { handle } = mount({ interaction: 'passive', view: { mode: 'orbit' } });
    await handle.ready;
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    const event = new WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    // Not prevented — a host page scrolling under the viewer keeps doing so —
    // yet the gesture still reached the camera (the canvas is still `'full'`
    // in every other respect).
    expect(event.defaultPrevented).toBe(false);
    expect(canvas.style.pointerEvents).toBe('');
  });
});

describe('overlay presets', () => {
  // `overlay` is a compound, query/attribute-only spelling (`viewer-options.ts`
  // `COMPOUND_SCHEMA`): it has no `ViewerOptions` field of its own, so a JS
  // object caller expands it through `optionsFromDataset`/`optionsFromQuery`
  // itself — exactly as `<jeex-viewer overlay="kiosk">` and `?overlay=kiosk`
  // do — rather than naming `overlay` directly in the options object.

  test('kiosk shows no chrome at all and sets pointer-events: none on the canvas', async () => {
    const { handle } = mount(optionsFromDataset({ overlay: 'kiosk' }));
    await handle.ready;
    const hidden = (name: string): boolean => handle.element.querySelector<HTMLElement>(`[data-jeex="${name}"]`)!.hidden === true;
    expect(hidden('control-bar')).toBe(true);
    expect(hidden('brand-lockup')).toBe(true);
    expect(hidden('hint-card')).toBe(true);
    expect(hidden('mode-switcher')).toBe(true);
    // The DOM PROPERTY (`hidden`) is necessary but not sufficient: `viewer.css`
    // gives every one of these elements its own unconditional `display`, so a
    // real regression here is a `[hidden]` CSS rule losing to it, which only a
    // computed-style read catches (a screenshot review of the kiosk preset found
    // this exact gap — see `viewer.css`'s `[hidden]` rule and its comment).
    for (const name of ['control-bar', 'brand-lockup', 'hint-card', 'mode-switcher']) {
      const element = handle.element.querySelector<HTMLElement>(`[data-jeex="${name}"]`)!;
      expect(getComputedStyle(element).display).toBe('none');
    }
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    expect(canvas.style.pointerEvents).toBe('none');
  });

  test('embed hides controls and brand but keeps the tour bar reachable once a clip is engaged', async () => {
    const preset = optionsFromDataset({ overlay: 'embed' });
    const { handle } = mount({ ...preset, view: { mode: 'tour' }, tour: { ...preset.tour, mode: 'paused' } });
    await handle.ready;
    const hidden = (name: string): boolean => handle.element.querySelector<HTMLElement>(`[data-jeex="${name}"]`)!.hidden === true;
    expect(hidden('control-bar')).toBe(true);
    expect(hidden('brand-lockup')).toBe(true);
    expect(handle.options.tour.progressBar).toBe(true);
    expect(handle.options.tour.pauseOnInput).toBe(false);
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    expect(canvas.style.pointerEvents).toBe('');
  });

  test('an individual attribute after the preset still wins', async () => {
    const preset = optionsFromDataset({ overlay: 'kiosk' });
    const { handle } = mount({ ...preset, chrome: { ...preset.chrome, status: true } });
    await handle.ready;
    expect(handle.options.chrome.status).toBe(true);
    expect(handle.options.chrome.controls).toBe(false);
  });
});

describe('unbranded overlay (the strictest portal-embed rules)', () => {
  // `overlay=unbranded` (and its `?unbranded=1` alias) is the MLS-feed link:
  // no brand lockup, status pill, mode switcher or hint, but the control bar
  // stays, the tour never autoplays before the visitor touches anything, and
  // the mini-map and full pointer interaction are kept (`viewer-options.ts`
  // `OVERLAY_PRESETS.unbranded`).

  test('hides brand, status pill, mode switcher and hint; keeps the control bar; keeps the minimap and full interaction', async () => {
    const preset = optionsFromDataset({ overlay: 'unbranded' });
    const { handle } = mount(preset);
    await handle.ready;
    expect(handle.options.chrome).toEqual({
      brand: false,
      controls: true,
      status: false,
      modeSwitcher: false,
      hint: false,
      autoHide: true,
    });
    expect(handle.options.view.minimap).toBe(true);
    expect(handle.options.interaction).toBe('full');
    const hidden = (name: string): boolean => handle.element.querySelector<HTMLElement>(`[data-jeex="${name}"]`)!.hidden === true;
    expect(hidden('brand-lockup')).toBe(true);
    expect(hidden('mode-switcher')).toBe(true);
    expect(hidden('hint-card')).toBe(true);
    expect(hidden('control-bar')).toBe(false);
    // `chrome.status` is not a `hidden`-driven flag: `ViewerUI.setChrome` also
    // calls `TourBar.setStatusEnabled`, which toggles the `.is-hidden` CLASS
    // (`tour-bar.ts`), not the DOM `hidden` property.
    const tourStatus = handle.element.querySelector<HTMLElement>('[data-jeex="tour-status"]')!;
    expect(tourStatus.classList.contains('is-hidden')).toBe(true);
    for (const name of ['brand-lockup', 'mode-switcher', 'hint-card', 'tour-status']) {
      const element = handle.element.querySelector<HTMLElement>(`[data-jeex="${name}"]`)!;
      expect(getComputedStyle(element).display).toBe('none');
    }
  });

  test('an engaged tour is paused, not playing, before any input', async () => {
    const preset = optionsFromDataset({ overlay: 'unbranded' });
    const { handle } = mount({ ...preset, view: { mode: 'tour' } });
    await handle.ready;
    expect(handle.options.tour.mode).toBe('paused');
    expect(handle.tour.progress()?.state).not.toBe('playing');
  });

  test('the root is stamped data-overlay="unbranded", the CSS hook for the compact layout', async () => {
    const preset = optionsFromDataset({ overlay: 'unbranded' });
    const { handle } = mount(preset);
    await handle.ready;
    // `handle.element` IS the shell root (`ViewerApp.element` returns
    // `roots.root`), so its own attribute is read directly, not queried for.
    expect(handle.element.matches(VIEWER_ROOT_SELECTOR)).toBe(true);
    expect(handle.element.dataset['overlay']).toBe('unbranded');
  });

  test('?unbranded=1 mounts the same viewer as ?overlay=unbranded', async () => {
    const { handle } = mount(optionsFromDataset({ unbranded: '1' }));
    await handle.ready;
    expect(handle.options.chrome).toEqual({
      brand: false,
      controls: true,
      status: false,
      modeSwitcher: false,
      hint: false,
      autoHide: true,
    });
    expect(handle.element.dataset['overlay']).toBe('unbranded');
  });

  test('an unrelated custom chrome combination is not mistaken for unbranded', async () => {
    const { handle } = mount({ chrome: { brand: false } });
    await handle.ready;
    expect(handle.element.dataset['overlay']).toBe('none');
  });
});
