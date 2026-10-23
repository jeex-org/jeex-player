/**
 * Rendering runtime: the WebGL renderer, the `THREE.Scene` with its sky and
 * fog, the lighting standard's context and apartment rig (`src/lighting/`),
 * resize handling, the per-frame loop with registrable hooks and the disposal
 * of all of it. The swatch preview draws with this same renderer and context
 * (`swatch-preview.ts`).
 *
 * Invariant: nothing here knows about the apartment. The runtime owns WebGL
 * resources and the frame clock; every scene-specific update runs as a frame
 * hook registered by the composition root, in registration order, before the
 * single `render` call of that frame.
 *
 * Visibility invariant: the loop runs only when the canvas could actually be
 * seen. `document.hidden` and `checkVisibility()` gate it, and the frame clock
 * is re-synchronised on resume so a tab that was away for a minute does not
 * hand the hooks a one-minute delta.
 *
 * Box invariant: the drawing buffer follows the ELEMENT's box, in device
 * pixels where the browser reports them (`devicePixelContentBoxSize`) and
 * `cssBox × devicePixelRatio` where it does not, and a change in either the box
 * or the display's DPR is applied on the next frame rather than inside the
 * observer callback.
 *
 * Context invariant: a WebGL context can be taken away at any moment — a GPU
 * driver reset, a backgrounded mobile tab, a page that opened its seventeenth
 * context. The runtime is the only thing that hears it: it stops the loop and
 * REPORTS through `onContextLost`, and when the browser gives the context back
 * it reports `onContextRestored` so the composition root can re-mount the
 * committed document. Nothing here decides what a lost context means for the
 * user; that is the composition root's answer. The one GPU resource the
 * runtime itself owns past a restore is the lighting: its prefiltered
 * environment was RENDERED, so it cannot be re-uploaded, and the runtime
 * replaces the lighting context and its rig before reporting the restore.
 */
import * as THREE from 'three';
import { Fanout } from '../shared/fanout.js';
import { setTextureAnisotropy, skyTexture } from '../materials/textures.js';
import { sharedTextureCache } from '../materials/texture-cache.js';
import { linkedAbortController } from '../shared/abort.js';
import { SwatchPreview, type PreviewRenderer } from './swatch-preview.js';
import { playerLighting } from './lighting-engine.js';
import { LIGHTING_STANDARD } from '../lighting/lighting-standard.js';
import type { ApartmentRig, LightingContext } from '../lighting/lighting-context.js';
import { installShadowLayerPass } from './shadow-layer-pass.js';

/** Device pixel ratio cap: above this the fill cost outgrows the visible gain. */
const PIXEL_RATIO_CAP = 1.7;
/** Shadow map resolution of the sun, in texels per side: the standard's default. */
const SHADOW_MAP_SIZE = LIGHTING_STANDARD.apartment.sun.shadow.defaultMapSize;
/**
 * Longest frame step handed to hooks, in seconds (a tab switch must not teleport).
 * Exported for `scripts/browser-check`, which measures motion on this clock.
 */
export const MAX_FRAME_DELTA = 0.05;
/**
 * While drawing is switched off (`plan2d`), one frame is still drawn this
 * often, beneath the opaque overlay. A WebGL context that draws nothing for
 * about a second lets the browser and the driver page out what the scene
 * draws with; the first frames after leaving the mode then waited 1.2–5 s on
 * the GPU (measured: plan2d → walk froze 0.55–2.6 s before the glide). A heartbeat of two frames a second keeps it resident; one per
 * second was measured to suffice too, so this keeps a margin.
 */
export const KEEP_WARM_MS = 500;
const SKY_TOP = '#dcd3c2';
const SKY_BOTTOM = '#c6b8a3';
const FOG_NEAR = 34; // metres
const FOG_FAR = 72; // metres

/** Per-frame callback: `delta` in seconds, `now` in milliseconds. */
export type FrameHook = (delta: number, now: number) => void;

/**
 * Element box the drawing buffer follows.
 *
 * `element` is optional so a unit harness can hand over a plain measurement,
 * but a real mount always passes one: it is what the `ResizeObserver` watches,
 * and a container that changes size without the WINDOW resizing (a flex
 * reflow, a `<details>` opening, a host layout change) is exactly the case a
 * `window` resize listener never saw.
 */
type ViewportBox = { clientWidth: number; clientHeight: number; element?: HTMLElement };

type RenderRuntimeOptions = {
  canvas: HTMLCanvasElement;
  viewport: ViewportBox;
  pixelRatioCap?: number;
  shadowMapSize?: number;
  /**
   * Injection seams. Bun has no WebGL context and no `requestAnimationFrame`,
   * so the unit test drives the loop with stubs; production uses the defaults.
   */
  createRenderer?: (canvas: HTMLCanvasElement) => THREE.WebGLRenderer;
  /** The lighting standard bound to the renderer; production builds it with the player's three.js. */
  createLighting?: (renderer: THREE.WebGLRenderer) => LightingContext;
  scheduleFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  /**
   * The context is gone: the loop has already been stopped and nothing will be
   * drawn until it comes back. The composition root shows the user what
   * happened and emits the public `error` event.
   */
  onContextLost?: (() => void) | undefined;
  /**
   * The browser gave the context back. Every GPU resource was dropped with it,
   * so the composition root re-mounts the committed document; this runtime
   * resumes the loop itself.
   */
  onContextRestored?: (() => void) | undefined;
  /** The mounted viewer's lifetime; aborting it unwinds every listener here. */
  signal?: AbortSignal | undefined;
  /** A frame hook threw. The frame goes on; the composition root reports it. */
  onError?: ((error: unknown) => void) | undefined;
};

/**
 * One `ResizeObserver` reading, in both units.
 *
 * The device box is the load-bearing half: computing it as `cssBox ×
 * devicePixelRatio` after CSS has already rounded the layout leaves a
 * half-pixel of blur on a fractional-DPR display, which is exactly what
 * `devicePixelContentBoxSize` exists to avoid. It is Chromium 84+ / Firefox
 * 108+ and NOT Baseline (no Safari), so both paths ship.
 */
type ObservedBox = { cssWidth: number; cssHeight: number; deviceWidth: number; deviceHeight: number };

/**
 * Measures one observer entry in CSS and in device pixels; `null` for a box
 * with no area (a hidden container reports zero and must not resize anything).
 */
export function measureEntry(entry: ResizeObserverEntry, pixelRatio: number): ObservedBox | null {
  const content = entry.contentBoxSize?.[0];
  const cssWidth = content ? content.inlineSize : entry.contentRect.width;
  const cssHeight = content ? content.blockSize : entry.contentRect.height;
  if (cssWidth <= 0 || cssHeight <= 0) return null;
  const device = entry.devicePixelContentBoxSize?.[0];
  return {
    cssWidth,
    cssHeight,
    deviceWidth: device ? device.inlineSize : Math.round(cssWidth * pixelRatio),
    deviceHeight: device ? device.blockSize : Math.round(cssHeight * pixelRatio),
  };
}

function defaultRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  return new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
}

export class RenderRuntime {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Sun shadow map size the apartment rigs of this runtime are built with. */
  readonly shadowMapSize: number;
  /** The lighting context now; replaced after a context restore. */
  private lightingContext: LightingContext;
  /** The apartment rig on `scene`, from `lightingContext`; its sun shadow is cached (`sun-shadow.ts`). */
  private rig: ApartmentRig;
  private readonly createLighting: (renderer: THREE.WebGLRenderer) => LightingContext;
  private camera: THREE.Camera | null = null;
  private renderEnabled = true;
  /** `now()` of the last frame actually drawn, for the keep-warm heartbeat. */
  private lastDrawn = Number.NEGATIVE_INFINITY;
  private readonly viewport: ViewportBox;
  private readonly hooks: Fanout<[number, number]>;
  private readonly postRenderHooks: Fanout<[number, number]>;
  private readonly schedule: (callback: () => void) => number;
  private readonly cancel: (handle: number) => void;
  private readonly now: () => number;
  private readonly report: (error: unknown) => void;
  private readonly canvas: HTMLCanvasElement;
  private readonly pixelRatioCap: number;
  /** Watches the viewport box; `null` where there is no `ResizeObserver`. */
  private readonly observer: ResizeObserver | null;
  /** The last box the observer reported; `null` before the first observation. */
  private box: ObservedBox | null = null;
  /** A resize coalesced into the next frame; `null` when none is pending. */
  private resizeHandle: number | null = null;
  /** The drawing buffer the renderer is currently built for; `-1` before the first. */
  private appliedWidth = -1;
  private appliedHeight = -1;
  private appliedRatio = -1;
  /** Whether the owner wants the loop running; visibility decides whether it is. */
  private running = false;
  private handle: number | null = null;
  private lastFrame = 0;
  private disposed = false;
  /** True between `webglcontextlost` and `webglcontextrestored`. */
  private contextLost = false;
  /** Every listener this runtime binds; `dispose` aborts it. */
  private readonly listeners: AbortController;

  constructor(options: RenderRuntimeOptions) {
    this.listeners = linkedAbortController(options.signal);
    this.viewport = options.viewport;
    this.schedule = options.scheduleFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancel = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
    this.now = options.now ?? (() => performance.now());
    this.report = options.onError ?? (() => undefined);
    this.hooks = new Fanout<[number, number]>((error) => this.report(error));
    this.postRenderHooks = new Fanout<[number, number]>((error) => this.report(error));
    this.canvas = options.canvas;
    this.pixelRatioCap = options.pixelRatioCap ?? PIXEL_RATIO_CAP;

    const sky = skyTexture(SKY_TOP, SKY_BOTTOM);
    if (sky) this.scene.background = sky;
    this.scene.fog = new THREE.Fog(SKY_BOTTOM, FOG_NEAR, FOG_FAR);

    this.renderer = (options.createRenderer ?? defaultRenderer)(options.canvas);
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(Math.max(1, this.viewport.clientWidth), Math.max(1, this.viewport.clientHeight), false);
    // The procedural textures outlive any one runtime and are shared between
    // viewers on a page, so this runtime takes a HOLD on them and frees it in
    // `dispose` — the last holder is what actually disposes (`texture-cache.ts`).
    sharedTextureCache.retain();
    // Grazing-angle floors and long walls need the hardware maximum here; with
    // two renderers the cache keeps the lower of the two caps.
    setTextureAnisotropy(this.renderer.capabilities.getMaxAnisotropy());

    // The lighting standard sets the display transform (PBR Neutral, exposure
    // 1, sRGB output) and PCF shadows on the renderer, and lights the scene
    // with its apartment rig.
    this.createLighting = options.createLighting ?? playerLighting;
    this.shadowMapSize = options.shadowMapSize ?? SHADOW_MAP_SIZE;
    this.lightingContext = this.createLighting(this.renderer);
    this.rig = this.lightingContext.createApartmentRig({ shadowMapSize: this.shadowMapSize, shadowCache: true });
    this.rig.attach(this.scene);
    // Shadow-only casters (hidden ceilings, cut-away walls) reach the shadow pass.
    installShadowLayerPass(this.renderer);

    this.preview = new SwatchPreview(
      this.renderer,
      () => this.lightingContext,
      () => !this.disposed && !this.contextLost,
    );
    this.observer = observeBox(options.viewport, this.onObserve);
    this.watchContext(options.canvas, options.onContextLost, options.onContextRestored);
    this.watchVisibility();
    this.watchPixelRatio();
  }

  /**
   * A new reading of the observed box, coalesced into the next frame.
   *
   * Resizing the renderer inside the observer callback is what raises the
   * browser's benign "ResizeObserver loop completed with undelivered
   * notifications" warning and makes a host animating a panel width pay a full
   * renderer resize per frame.
   */
  private readonly onObserve = (entries: ResizeObserverEntry[]): void => {
    const entry = entries.at(-1);
    if (entry) this.box = measureEntry(entry, devicePixelRatioOf());
    if (this.resizeHandle !== null) return;
    this.resizeHandle = this.schedule(() => {
      this.resizeHandle = null;
      this.resize();
    });
  };

  /**
   * The loop runs only while the canvas could actually be seen.
   *
   * `document.hidden` catches a backgrounded tab; `checkVisibility()` catches
   * `display: none` and `content-visibility: hidden`, which no observer
   * reports (newly Baseline, Safari 17.4). Both are
   * feature-detected, and an environment offering neither is treated as
   * visible, which is the truthful default.
   *
   * Read off `this.canvas.ownerDocument`, not the global: a canvas mounted
   * into a different document (an iframe embed) is hidden by THAT document
   * going to the background, and the top page's own `document.hidden` says
   * nothing about it. `typeof document === 'undefined'` is a SEPARATE check
   * — not the multi-document one, an environment-has-no-DOM-at-all one — for
   * `bun test`'s fake canvas, which has no `ownerDocument` to read.
   */
  private watchVisibility(): void {
    if (typeof document === 'undefined') return;
    this.canvas.ownerDocument.addEventListener(
      'visibilitychange',
      () => {
        if (this.isVisible()) this.resume();
        else this.pause();
      },
      { signal: this.listeners.signal },
    );
  }

  /** Whether a frame drawn now could be seen by anyone. */
  private isVisible(): boolean {
    if (typeof document !== 'undefined' && this.canvas.ownerDocument.hidden) return false;
    const canvas = this.canvas as Partial<HTMLCanvasElement>;
    if (typeof canvas.checkVisibility !== 'function') return true;
    return canvas.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true });
  }

  /** Stops drawing without forgetting that the owner asked for a running loop. */
  private pause(): void {
    if (this.handle === null) return;
    this.cancel(this.handle);
    this.handle = null;
  }

  /** Starts drawing again, with the frame clock re-synchronised to now. */
  private resume(): void {
    if (!this.running || this.handle !== null || this.disposed || this.contextLost) return;
    if (!this.isVisible()) return;
    this.lastFrame = this.now();
    this.handle = this.schedule(this.frame);
  }

  /**
   * Follows the display's device pixel ratio.
   *
   * There is no `devicepixelratiochange` event: the documented pattern is a
   * `(resolution: Ndppx)` media query for the CURRENT ratio, which stops
   * matching the moment the window is dragged onto a display with another one.
   * The listener is one-shot and re-armed for the new ratio, so this costs one
   * live listener whatever happens.
   */
  private watchPixelRatio(): void {
    if (typeof matchMedia !== 'function') return;
    const arm = (): void => {
      const query = matchMedia(`(resolution: ${devicePixelRatioOf()}dppx)`);
      query.addEventListener(
        'change',
        () => {
          this.resize();
          arm();
        },
        { once: true, signal: this.listeners.signal },
      );
    };
    arm();
  }

  /**
   * The ratio the drawing buffer is built at: measured from the device box
   * where the browser reports one, `window.devicePixelRatio` otherwise, capped
   * because above the cap the fill cost outgrows the visible gain.
   */
  private pixelRatio(): number {
    const box = this.box;
    const measured = box && box.cssWidth > 0 ? box.deviceWidth / box.cssWidth : devicePixelRatioOf();
    return Math.min(measured, this.pixelRatioCap);
  }

  /**
   * The two context events, on the canvas three.js is drawing into.
   *
   * three has its own pair of handlers (it flips `_isContextLost` and rebuilds
   * its GL state on restore); these are registered after them and answer the
   * question three does not: what the APPLICATION should do about it.
   * `preventDefault` on the loss is what asks the browser to restore the
   * context at all, and it is idempotent — three already called it.
   */
  private watchContext(canvas: HTMLCanvasElement, onLost?: () => void, onRestored?: () => void): void {
    // A unit harness hands over a plain object for the canvas; it has no
    // events, and a runtime without them simply never loses its context.
    if (typeof canvas.addEventListener !== 'function') return;
    const { signal } = this.listeners;
    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        this.contextLost = true;
        this.stop();
        onLost?.();
      },
      { signal },
    );
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        this.contextLost = false;
        // three built a new shadow map with the context; wrap it again.
        installShadowLayerPass(this.renderer);
        this.renewLighting();
        onRestored?.();
        this.start();
      },
      { signal },
    );
  }

  /**
   * A new lighting context and apartment rig, after a context restore: the
   * old environment was rendered into a target the lost context took with it.
   * Disposing the old context detaches its rig and every swatch rig made from
   * it; the preview builds its next rig from the new one.
   */
  private renewLighting(): void {
    this.lightingContext.dispose();
    this.lightingContext = this.createLighting(this.renderer);
    this.rig = this.lightingContext.createApartmentRig({ shadowMapSize: this.shadowMapSize, shadowCache: true });
    this.rig.attach(this.scene);
  }

  /** The apartment rig lighting `scene` now; replaced after a context restore, so read it at the moment of use. */
  get sunRig(): ApartmentRig {
    return this.rig;
  }

  /**
   * The lighting standard bound to this runtime's renderer. A capture builds
   * its own rigs from it (`app/capture-commands.ts`); it is replaced after a
   * context restore, so read it at the moment of use.
   */
  get lighting(): LightingContext {
    return this.lightingContext;
  }

  /** True while the GL context is gone and nothing can be drawn. */
  isContextLost(): boolean {
    return this.contextLost;
  }

  /**
   * The camera the loop renders with; also drives the aspect on resize.
   *
   * A `THREE.Camera`, not a perspective one: the 3D top view installs an
   * orthographic camera here and takes it away again (`plan-modes.ts`). An
   * orthographic frustum depends on the plan, not on the runtime, so its owner
   * refits it on resize and the runtime only touches a perspective aspect.
   */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.resize();
  }

  /** The camera the next frame will be drawn with; `null` before the first one. */
  getCamera(): THREE.Camera | null {
    return this.camera;
  }

  /**
   * Whether the loop draws every frame. `false` keeps every frame hook
   * running and draws only a keep-warm frame every `KEEP_WARM_MS`, which is
   * what the flat 2D mode wants: the drawing overlays an opaque canvas, so
   * nothing drawn behind it shows, and the heartbeat keeps the way back to
   * the 3D view from stalling.
   */
  setRenderEnabled(enabled: boolean): void {
    this.renderEnabled = enabled;
  }

  isRenderEnabled(): boolean {
    return this.renderEnabled;
  }

  addFrameHook(hook: FrameHook): void {
    // `Fanout` is a `Set`, so registering the same hook twice leaves one.
    this.hooks.add(hook);
  }

  removeFrameHook(hook: FrameHook): void {
    this.hooks.remove(hook);
  }

  /**
   * The frame clock reading (`now`, ms) of the last frame that actually RENDERED
   * the scene; `-Infinity` before the first. A post-render hook compares it with
   * its own `now` to tell a drawn frame from one the plan heartbeat skipped.
   */
  get lastDrawnAt(): number {
    return this.lastDrawn;
  }

  /**
   * A hook that runs AFTER the frame's render, while the GL state is still
   * current. This is where an inset render lives — the camera-preview card
   * draws the scene from a second camera into a scissored corner of the SAME
   * canvas, and anything drawn before `renderer.render` would be cleared by
   * it. There is no per-frame cost when the list is empty.
   */
  addPostRenderHook(hook: FrameHook): void {
    this.postRenderHooks.add(hook);
  }

  removePostRenderHook(hook: FrameHook): void {
    this.postRenderHooks.remove(hook);
  }

  start(): void {
    if (this.disposed) return;
    this.running = true;
    this.resume();
  }

  stop(): void {
    this.running = false;
    this.pause();
  }

  resize(): void {
    const width = Math.max(1, this.viewport.clientWidth);
    const height = Math.max(1, this.viewport.clientHeight);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    // Nothing to do when nothing moved. `setPixelRatio` reapplies the last
    // size internally, so the naive pair reallocates the drawing buffer TWICE
    // per observation — and an observation arrives for a box that rounded to
    // the same device pixels as often as for one that really changed.
    const ratio = this.pixelRatio();
    if (width === this.appliedWidth && height === this.appliedHeight && ratio === this.appliedRatio) return;
    this.appliedWidth = width;
    this.appliedHeight = height;
    this.appliedRatio = ratio;
    // The ratio first: `setSize` builds the drawing buffer from it, so applying
    // it afterwards would leave one frame at the old resolution.
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
  }

  /**
   * Swatch pictures, drawn with THIS renderer into a render target
   * (`swatch-preview.ts`). Built in the constructor because it holds no GPU
   * resource until the first swatch asks for one.
   */
  readonly preview: PreviewRenderer;

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.running = false;
    this.hooks.clear();
    this.postRenderHooks.clear();
    if (this.resizeHandle !== null) this.cancel(this.resizeHandle);
    this.resizeHandle = null;
    this.listeners.abort();
    this.observer?.disconnect();
    this.preview.dispose();
    // Disposes the apartment rig (which restores the scene's environment)
    // and then the prefiltered environment itself.
    this.lightingContext.dispose();
    // The sky comes from the shared texture cache, whose ref count the
    // `release` below settles. Clearing the reference is what stops the scene
    // pointing at a texture the last holder may already have freed.
    this.scene.background = null;
    this.renderer.dispose();
    // `dispose()` frees the GPU resources; the CONTEXT itself only goes when
    // it is explicitly lost. Browsers cap a page at ~16 live contexts, so a
    // host that mounts and unmounts a viewer per route would run out of them.
    // `forceContextLoss` is a no-op where the
    // extension is missing, and absent entirely on a unit-harness renderer.
    this.renderer.forceContextLoss?.();
    // Idempotence matters here: `release` refuses to go below zero, because
    // that would free textures a sibling viewer is still drawing with.
    sharedTextureCache.release();
  }

  private frame = (): void => {
    this.handle = this.schedule(this.frame);
    const now = this.now();
    const delta = Math.min(MAX_FRAME_DELTA, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    // The copy-before-iterate and the per-hook try/catch are `Fanout`'s
    // (`shared/fanout.ts`): walking a live array would make a hook that removed
    // itself skip the NEXT hook, and one throwing hook would abort the whole
    // frame — the remaining hooks and the render with it, freezing the picture
    // with nothing reported.
    this.hooks.emit(delta, now);
    if (this.camera && (this.renderEnabled || now - this.lastDrawn >= KEEP_WARM_MS)) {
      this.renderer.render(this.scene, this.camera);
      this.lastDrawn = now;
    }
    // The post-render hooks run even when the render itself is OFF (plan2d):
    // the camera-preview card's visibility sync lives there, and a card left
    // standing over a scene that stopped being drawn is exactly the bug a
    // skipped hook produces. A drawing hook guards itself.
    this.postRenderHooks.emit(delta, now);
  };
}

/**
 * The answer to "can this browser give the viewer a WebGL context at all",
 * decided once per process.
 *
 * The probe COSTS a context, and browsers cap a page at about sixteen: called
 * afresh on every `mountViewer` and every Retry, it would exhaust them and
 * then refuse the real renderer. So the answer is
 * memoised — a browser does not change its mind about WebGL inside one page —
 * and the probe hands its context straight back through `WEBGL_lose_context`.
 *
 * The no-`document` case is NOT memoised: it is a statement about the
 * environment this was called in, not about the browser.
 */
let webglSupport: boolean | null = null;

export function hasWebGL(): boolean {
  if (webglSupport !== null) return webglSupport;
  if (typeof document === 'undefined') return false;
  // The global on purpose, not an `ownerDocument`: this runs before any
  // viewer root exists (`ViewerApp.init()` calls it first, ahead of every
  // other DOM access) and the answer is memoised process-wide, not per
  // instance — there is no element yet to take a document FROM.
  const probe = document.createElement('canvas');
  const context = probe.getContext('webgl2') ?? probe.getContext('webgl');
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  webglSupport = context !== null;
  return webglSupport;
}

/**
 * Watches a viewport box for size changes.
 *
 * The observer sees the CONTAINER, so an embedded viewer follows its own box
 * rather than the window; a box with no element (a unit harness) and an
 * environment with no `ResizeObserver` both simply get no watch, which is the
 * truthful answer — never a `window` listener standing in for one, because
 * that reports the wrong element's size.
 */
function observeBox(box: ViewportBox, onObserve: ResizeObserverCallback): ResizeObserver | null {
  if (!box.element || typeof ResizeObserver === 'undefined') return null;
  const observer = new ResizeObserver(onObserve);
  // `device-pixel-content-box` is asked for explicitly: without it the entry
  // carries no `devicePixelContentBoxSize` even where the browser supports it.
  // A browser that does not know the value throws, and the CSS box is then the
  // only reading there is.
  try {
    observer.observe(box.element, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(box.element);
  }
  return observer;
}

/** `window.devicePixelRatio` where there is a window, 1 elsewhere. */
function devicePixelRatioOf(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio;
}

export function createRenderRuntime(options: RenderRuntimeOptions): RenderRuntime {
  return new RenderRuntime(options);
}
