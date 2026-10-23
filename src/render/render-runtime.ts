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
 * single draw of that frame: straight to the screen, or through the post-
 * processing chain attached with `setPostProcessor` (walk and tour). In walk
 * and tour the draw happens only on demand (`render-demand.ts`, `demand`).
 *
 * First-picture invariant: a started loop draws its first picture only once
 * the scene's programs were compiled asynchronously, or the bound passed
 * (`first-draw.ts`); the hooks run meanwhile, nothing counts as drawn, and
 * `firstDraw` resolves after that picture. The first `start()` arms both, and
 * so does the one after a context restore; a stop and start that kept the
 * context (a video capture) does not.
 *
 * Visibility invariant: the loop runs only when the canvas could actually be
 * seen. `document.hidden` and `checkVisibility()` gate it, and the frame clock
 * is re-synchronised on resume so a tab that was away for a minute does not
 * hand the hooks a one-minute delta. A canvas taken out of the document
 * without `dispose()` parks the loop at its next frame, and the box observer
 * resumes it when the canvas is connected again.
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
import { withScenePass } from '../shared/scene-pass.js';
import type { PostProcessor } from './post-processor.js';
import { RenderDemand } from './render-demand.js';
import { FirstDrawGate, FirstDrawSignal } from './first-draw.js';
import { compileScene } from './scene-compile.js';
import { devicePixelRatioOf, measureEntry, observeBox, type ObservedBox, type ViewportBox } from './viewport-box.js';

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
 * the GPU (plan2d → walk froze 0.55–2.6 s before the glide). Two frames a
 * second keep it resident; one was measured to suffice, so this has a margin.
 */
export const KEEP_WARM_MS = 500;
const SKY_TOP = '#dcd3c2';
const SKY_BOTTOM = '#c6b8a3';
const FOG_NEAR = 34; // metres
const FOG_FAR = 72; // metres

/** Per-frame callback: `delta` in seconds, `now` in milliseconds. */
export type FrameHook = (delta: number, now: number) => void;

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
  /** The camera mode now: walk and tour draw on demand (`render-demand.ts`). */
  mode?: (() => string | undefined) | undefined;
};

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
  /** The chain the frame renders through (`walk-post.ts`), or `null` for straight to the screen. */
  private post: PostProcessor | null = null;
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
  private readonly mode: () => string | undefined;
  /** Whether a tick draws; `invalidate()` it for anything visible that changed. */
  readonly demand = new RenderDemand();
  /** Holds the first display draw of a started loop until its shaders compiled. */
  private readonly gate = new FirstDrawGate({
    setTimeout: (run, ms) => setTimeout(run, ms) as unknown as number,
    clearTimeout: (handle) => clearTimeout(handle),
  });
  /** «The first picture since `start()` is on screen»: the viewer's `ready` waits on it. */
  readonly firstDraw = new FirstDrawSignal();
  /** Whether the next `start()` owes a first picture: the first one, and the one after a context restore. */
  private firstOwed = true;
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
    this.mode = options.mode ?? (() => undefined);
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
    // The procedural textures are shared between viewers on a page: a HOLD,
    // freed in `dispose`; the last holder disposes (`texture-cache.ts`).
    sharedTextureCache.retain();
    // The hardware maximum for grazing floors; two renderers keep the lower cap.
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
    this.resizeHandle ??= this.schedule(() => {
      this.resizeHandle = null;
      this.resize();
    });
    // The observer is also the wake signal of a loop parked on a detached
    // canvas: an element inserted into or removed from a document is an
    // observation (its box goes from or to nothing), so a host putting the
    // viewer back resumes it here, after the resize queued above.
    this.resume();
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
    if (this.isDetached()) return false;
    if (typeof document !== 'undefined' && this.canvas.ownerDocument.hidden) return false;
    const canvas = this.canvas as Partial<HTMLCanvasElement>;
    if (typeof canvas.checkVisibility !== 'function') return true;
    return canvas.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true });
  }

  /**
   * The canvas is not in any document: a host took the viewer off the page
   * without `dispose()`. Nothing drawn now can be seen, and a loop drawing
   * into a detached canvas keeps the GPU busy for nothing (on a software
   * rasteriser it starved the next page load for about a minute), so the loop
   * parks. Only where the box observer exists: it is what wakes the loop when
   * the canvas is connected again (`onObserve`), and a park nothing can end
   * would freeze a viewer that is put back.
   */
  private isDetached(): boolean {
    return this.observer !== null && !this.canvas.isConnected;
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
    this.demand.invalidate();
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
        // Owed from now: the restore's own announcement reads it before `start()`.
        this.firstOwed = true;
        this.firstDraw.arm();
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

  /**
   * Renders every frame through `post` (sized to the drawing buffer now and
   * on every resize), or straight to the screen again with `null`. The
   * runtime never disposes a chain: its owner does (`app/walk-post-controller.ts`).
   */
  setPostProcessor(post: PostProcessor | null): void {
    this.post = post;
    this.demand.invalidate();
    post?.setSize(this.appliedWidth, this.appliedHeight, this.appliedRatio);
  }

  addFrameHook(hook: FrameHook): void {
    // `Fanout` is a `Set`, so registering the same hook twice leaves one.
    this.hooks.add(hook);
  }

  removeFrameHook(hook: FrameHook): void {
    this.hooks.remove(hook);
  }

  /**
   * The frame clock reading (`now`, ms) of the last display draw; `-Infinity`
   * before the first. A post-render hook compares it with its own `now` to
   * tell a drawn tick from a skipped one (the plan heartbeat, a resting walk).
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
    // A stop and start that kept the context (a video capture) keeps its programs: nothing to compile.
    if (!this.running && this.firstOwed) this.armFirstDraw();
    this.running = true;
    this.resume();
  }

  /**
   * A first picture is owed, drawn once the scene compiled asynchronously
   * (`first-draw.ts`) for the path that draws it: through the attached chain
   * (its own target, `PostProcessor.compile`) or straight to the screen
   * (`scene-compile.ts`).
   */
  private armFirstDraw(): void {
    this.firstOwed = false;
    this.firstDraw.arm();
    const camera = this.camera;
    const post = this.post;
    if (!camera) {
      this.gate.arm(null);
      return;
    }
    const pending = post ? post.compile(this.scene, camera) : compileScene(this.renderer, this.scene, camera);
    this.gate.arm(pending === null ? null : () => pending);
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
    this.demand.invalidate();
    this.appliedWidth = width;
    this.appliedHeight = height;
    this.appliedRatio = ratio;
    // The ratio first: `setSize` builds the drawing buffer from it, so applying
    // it afterwards would leave one frame at the old resolution.
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.post?.setSize(width, height, ratio);
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
    // Checked before the next frame is asked for, so a detached canvas parks
    // the loop instead of drawing; `onObserve` resumes it on reattach.
    if (this.isDetached()) {
      this.handle = null;
      return;
    }
    this.handle = this.schedule(this.frame);
    const now = this.now();
    const delta = Math.min(MAX_FRAME_DELTA, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    // Copy-before-iterate and per-hook try/catch are `Fanout`'s: a hook that
    // removed itself must not skip the NEXT one, and a throwing hook must not
    // abort the frame (the render with it) with nothing reported.
    this.hooks.emit(delta, now);
    // Committed only after the draw returned: a throwing draw keeps the demand.
    const camera = this.camera;
    // While the first-picture gate holds, the tick is counted and nothing commits or counts as drawn.
    if (
      camera &&
      this.demand.shouldDraw(camera, this.mode()) &&
      this.gate.open &&
      (this.renderEnabled || now - this.lastDrawn >= KEEP_WARM_MS)
    ) {
      this.draw(camera, delta);
      this.lastDrawn = now;
      this.demand.commit(camera);
      this.firstDraw.drawn();
    }
    // The post-render hooks run on skipped ticks too (plan2d, a resting walk):
    // the camera-preview card's visibility sync lives there. A drawing hook
    // guards itself, and none may draw on a skipped tick in walk or tour.
    this.postRenderHooks.emit(delta, now);
  };

  /**
   * The frame's picture: through the attached chain, or to the screen inside
   * the beauty-pass scope a mirror captures in (`shared/scene-pass.ts`).
   */
  private draw(camera: THREE.Camera, delta: number): void {
    if (this.post) {
      this.post.render(this.scene, camera, delta);
      return;
    }
    withScenePass(this.renderer, { target: null, scene: this.scene, camera }, () => this.renderer.render(this.scene, camera));
  }
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

export function createRenderRuntime(options: RenderRuntimeOptions): RenderRuntime {
  return new RenderRuntime(options);
}
