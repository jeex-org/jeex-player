/**
 * The 3D stage of one mounted viewer: the renderer, the perspective camera,
 * the two plan modes, the mini-map, the camera director and the frame loop.
 *
 * Everything here exists once per MOUNT and outlives every document; what
 * exists once per DOCUMENT is `SceneMount`'s. The composition root holds one of
 * each and is the only thing that knows about both.
 *
 * Invariant: the stage never reads the scene. It is handed a committed
 * `SceneModel` in `setDocument` and passes it on — the camera director owns the
 * plan-derived state, the mini-map owns the drawing, and neither asks this
 * module for anything.
 */

import type { AssetFactsSource } from '../assets/asset-facts.js';
import type { UsageSink } from '../shared/usage.js';
import * as THREE from 'three';
import { createRenderRuntime, type FrameHook, type RenderRuntime } from '../render/render-runtime.js';
import { DEFAULT_MINIMAP_ACCENT, resolveBackdrop, resolveThemeColour } from '../ui/theme-colour.js';
import { mountCameraDirector, type CameraDirector, type CameraStackDeps } from '../camera/camera-director.js';
import { WalkCameraBar } from '../ui/walk-camera-bar.js';
import type { SceneData, TourCheckpoint } from '../scene/types.js';
import { PlanModes, type PlanModeOptions } from '../ui/plan-modes.js';
import { Minimap } from '../ui/minimap.js';
import { ScrollHint, TAP_HINT_NAME } from '../ui/scroll-hint.js';
import { cameraMarker } from '../render/viewport-projection.js';
import { CAMERA_TUNING, FAR_PLANE_M, NEAR_PLANE_M } from '../camera/camera-tuning.js';
import { FLOOR_RING_LAYER } from '../shared/render-layers.js';
import type { AnchorScene } from './slot-anchor.js';
import type { Messages } from '../ui/messages.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { ViewerRoots } from '../ui/viewer-shell.js';
import type { FullscreenController } from '../ui/fullscreen-controller.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import type { ViewerMode } from '../scene/types.js';
import { ViewerSelectionController, type ViewerSelection } from './selection.js';
import type { Picker } from '../geometry/picker.js';
import { loadWalkPost, WalkPostController } from './walk-post-controller.js';
import { hdriLoads, loadWalkLighting, WalkLightingController, type HdriDeps } from './walk-lighting-controller.js';
import type { QualityControl } from './quality-control.js';
import { wireWalkLighting } from './walk-lighting-wiring.js';
import type { WalkDocument } from '../render/walk-lighting/walk-lighting.js';
import type { PostProcessor } from '../render/post-processor.js';
import { findSiteGround, setSiteGroundLit } from '../geometry/site-ground.js';
import { replaceSceneCanvas } from '../ui/scene-canvas.js';

/**
 * What the stage needs from the application, minus the camera it builds itself.
 * The director's own wiring is passed through verbatim: those callbacks reach
 * the editor and the doors, which are not the stage's business.
 */
export type ViewerStageDeps = {
  roots: ViewerRoots;
  viewport: FullscreenController;
  messages: Messages;
  dollhouse: Dollhouse;
  /** Whether the mini-map is offered at all (`options.view.minimap`). */
  minimapEnabled: () => boolean;
  /** Whether the walk's Previous/Next camera buttons are offered (`options.chrome.controls`). */
  walkCamerasEnabled: () => boolean;
  /**
   * `options.plan` — which of the 2D drawing's labels, dimension chains and
   * camera marker the host asked for (`app/viewer-options.ts`).
   *
   * A getter and not a value, like `minimapEnabled` beside it: the stage is
   * built once per MOUNT and the options are the application's, so reading them
   * per paint is what keeps the two from drifting. Without this the three
   * options were parsed, validated, published in `OPTION_SCHEMA` — and then
   * dropped on the floor: `PlanModes` fell back to its own «everything on»
   * default for the life of the viewer, and `plan-camera="0"` drew the marker
   * anyway (found from an embedding editor host).
   */
  planOptions: () => PlanModeOptions;
  /** The render quality tier (`quality-control.ts`): the runtime and the walk builds start on it, and it feeds on drawn frames. */
  quality: QualityControl;
  /** The mounted document's bank, for the plan's fixtures (`SceneMount.assetFacts`). */
  assetFacts: () => AssetFactsSource;
  /** A click on a room of the map: the application decides how to get there. */
  onRoomPicked: (roomId: string) => void;
  /** The GL context was taken away; the loop is already stopped. */
  onContextLost?: (() => void) | undefined;
  /** The GL context came back: re-mount the committed document before the loop resumes. */
  onContextRestored?: (() => void) | undefined;
  /** The mounted viewer's lifetime; every listener under the stage carries it. */
  signal?: AbortSignal | undefined;
  /** A frame hook threw; the frame went on and the application reports it. */
  onFrameError?: ((error: unknown) => void) | undefined;
  /** Hears accepted camera steps and map use (`shared/usage.ts`). */
  usage?: UsageSink | undefined;
  /** Puts the current colour temperature on artificial lights added later (the walk's ambient floor). */
  artificialLights?: ((root: THREE.Object3D) => void) | undefined;
  /** The host sky (`lighting.hdri`, `hdri-wiring.ts`); its files load in the walk chunk on this stage's renderer. */
  hdri?: Omit<HdriDeps, 'loads'> | undefined;
  /**
   * `options.select` and the sink for the `select` event (`app/selection.ts`).
   * `listen: false` attaches no pointer listener at all; the controller is
   * still built, so `ViewerHandle.setSelection` works whatever the option says
   * — the option gates the EVENT, not the host's own command.
   */
  selection: { listen: boolean; emit: (selection: ViewerSelection) => void };
  /** The committed document's tour cameras, for the mini-map's dots; `undefined` before the first document. */
  tourCameras: () => readonly TourCheckpoint[] | undefined;
  /**
   * The director's wiring, minus what the stage supplies (camera, canvas, keys,
   * ui). Carries `interaction` (`director-wiring.ts`): `'none'`
   * sets `pointer-events: none` on the canvas (below) AND is threaded to
   * `mountCameraDirector` so `CameraInput` is never attached; `'passive'` only
   * does the latter. Default `'full'`.
   */
  director: Omit<
    CameraStackDeps,
    'camera' | 'canvas' | 'keys' | 'messages' | 'dollhouse' | 'planModes' | 'onScrollThrough' | 'onSwipeThrough' | 'onPress'
  >;
};

/**
 * The frame hooks of one mount, in the order they MUST run.
 *
 * The camera and the tour go first: everything the application's own hooks do
 * — the dollhouse fade, the door automation, the HUD anchor, the mini-map
 * marker — reads the pose of the frame that is about to be drawn, and reading
 * it before the camera has been advanced is one frame of lag on every one of
 * them. It was an implicit consequence of two statements in `start()` and a
 * comment in `viewer-app.ts`; it is a named function with a test now.
 */
export function orderFrameHooks(cameraHook: FrameHook, appHooks: readonly FrameHook[]): readonly FrameHook[] {
  return [cameraHook, ...appHooks];
}

/**
 * What the authoring tools (loaded lazily, `authoring.ts`) run inside the
 * stage's frame, at fixed places: `afterCamera` right after the camera rig
 * moved (the look-through's height, the rig's visibility, the overlay's
 * constant-size handles), `frameEnd` after every application hook and before
 * the draw decision (the overlay's deferred tube, the preview card's sync),
 * `postRender` after a drawn frame (the preview inset), and `document` where
 * the stage adopts a committed document, so a host's first `scene` subscriber
 * already finds the tools on it.
 */
export type StageAuthoringHooks = {
  afterCamera(): void;
  frameEnd(): void;
  postRender(): void;
  /** A committed document was adopted (`ViewerStage.setDocument`), before the `scene` event announces it. */
  document(scene: SceneData): void;
};

/**
 * Registers one mount's frame on `runtime`: the camera rig's update, the
 * authoring tools' `afterCamera`, the tour, the application hooks in their
 * order, the authoring `frameEnd`; and the authoring `postRender` after the
 * draw. The authoring hooks are read per frame, so tools bound later run at
 * exactly these places, whatever the order they registered in.
 */
export function bindStageFrame(
  runtime: Pick<RenderRuntime, 'addFrameHook' | 'addPostRenderHook'>,
  steps: { camera: FrameHook; tour: FrameHook; authoring: () => StageAuthoringHooks | null },
  appHooks: readonly FrameHook[],
): void {
  const cameraHook: FrameHook = (delta, now) => {
    steps.camera(delta, now);
    steps.authoring()?.afterCamera();
    steps.tour(delta, now);
  };
  const frameEnd: FrameHook = () => steps.authoring()?.frameEnd();
  for (const hook of [...orderFrameHooks(cameraHook, appHooks), frameEnd]) runtime.addFrameHook(hook);
  runtime.addPostRenderHook(() => steps.authoring()?.postRender());
}

/** Whether `object` still hangs under `root` (a rebuild takes the old root off the scene). */
function isUnder(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === root) return true;
  return false;
}

/**
 * The camera a host anchor projects through: the one that puts the object
 * where the visitor SEES it.
 *
 * In both plan modes that is the plan's top view, not the perspective rig,
 * which the plan modes freeze where the last 3D mode left it — projecting
 * through the rig placed a host editor's selection card where the object had
 * been in orbit. In `plan3d` the top view draws; in `plan2d` the drawing is
 * fitted to the same bounds with the same padding, which is why a pick there
 * is cast through it too (`PlanModes.pickCamera`).
 */
export function anchorCamera(planModes: Pick<PlanModes, 'pickCamera'>, perspective: THREE.Camera): THREE.Camera {
  return planModes.pickCamera() ?? perspective;
}

export class ViewerStage {
  private readonly deps: ViewerStageDeps;
  readonly runtime: RenderRuntime;
  readonly camera: THREE.PerspectiveCamera;
  readonly planModes: PlanModes;
  readonly minimap: Minimap;
  /** The walk's Previous/Next camera buttons and index (`ui/walk-camera-bar.ts`). */
  readonly walkCameras: WalkCameraBar;
  /** The mini-map's camera dots and the list they were derived from (`cameraDots`). */
  private dotsFor: readonly TourCheckpoint[] | undefined;
  private dots: readonly { x: number; z: number }[] = [];
  readonly selection: ViewerSelectionController;
  /** «Ctrl + scroll to zoom», shown when a plain wheel went to the page. */
  readonly scrollHint: ScrollHint;
  /** «Tap to look around»: once per view, after a vertical swipe went to the page. */
  readonly tapHint: ScrollHint;
  private cameraDirector?: CameraDirector;
  /** The walk and tour post-processing chain: loaded on demand, attached in those modes (`walk-post-controller.ts`). */
  readonly walkPost: WalkPostController;
  /** The walk and tour room lighting: built after the chain, baked on entry (`walk-lighting-controller.ts`). */
  readonly walkLighting: WalkLightingController;
  /** The render quality tier: built the runtime and the chains on it, fed by the frames it draws (`quality-control.ts`). */
  readonly quality: QualityControl;
  /** The document the room lighting is built for, and the end of its edit subscription. */
  private lightingDocument: { document: () => WalkDocument | null; off: () => void } | null = null;
  private disposed = false;
  /** Camera-view captures in flight (`underDaylightSky`): the live sky stays the daylight one until the last is done. */
  private daylightCaptures = 0;
  /** The live scene's site ground, kept between frames; `null` before the first build or when a rebuild dropped it. */
  private siteGround: THREE.Mesh | null = null;
  /** The authoring tools' frame hooks (`setAuthoring`); `null` while none is bound. */
  private authoringHooks: StageAuthoringHooks | null = null;

  /**
   * Builds the renderer and everything that hangs off it. `start` is the pose
   * the first document's presentation camera names, so the very first frame is
   * already framed rather than at the origin.
   */
  constructor(deps: ViewerStageDeps, start: { x: number; y: number; z: number }) {
    this.deps = deps;
    // `interaction: 'none'`: the canvas passes every pointer event
    // through to whatever the host renders behind it. `CameraInput` is never
    // attached either (`setDocument` -> `mountCameraDirector`, below) — the
    // style alone would still let the canvas SEE the events, just not react.
    if (deps.director.interaction === 'none') deps.roots.canvas.style.setProperty('pointer-events', 'none');
    // The runtime and the two walk builds below start on the tier the control
    // answers; only a live switch applies one.
    this.quality = deps.quality;
    this.runtime = createRenderRuntime({
      canvas: deps.roots.canvas,
      viewport: deps.viewport,
      pixelRatioCap: this.quality.pixelRatioCap,
      onContextLost: () => {
        this.walkPost.contextLost();
        this.walkLighting.contextLost();
        deps.onContextLost?.();
      },
      onContextRestored: () => {
        this.walkPost.contextRestored();
        this.walkLighting.contextRestored();
        deps.onContextRestored?.();
      },
      signal: deps.signal,
      onError: deps.onFrameError,
      // Every mode but `plan2d` draws on demand (`render/render-demand.ts`).
      mode: () => this.mode,
    });
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_TUNING.fov.wide,
      deps.viewport.clientWidth / deps.viewport.clientHeight,
      NEAR_PLANE_M,
      FAR_PLANE_M,
    );
    this.camera.position.set(start.x, start.y, start.z);
    // The walk floor ring is drawn by this camera alone (`FLOOR_RING_LAYER`).
    this.camera.layers.enable(FLOOR_RING_LAYER);
    this.runtime.setCamera(this.camera);
    this.walkPost = new WalkPostController({
      build: () =>
        loadWalkPost(
          this.runtime.renderer,
          this.runtime.scene,
          this.camera,
          {
            live: () => this.walkLighting.balance(),
            at: (position) => this.walkLighting.balanceAt(position),
          },
          this.quality.chainInputs,
        ),
      attach: (chain) => this.runtime.setPostProcessor(chain),
      report: (error) => deps.onFrameError?.(error),
      // The scene's programs for the chain's own target, linked before the first frame through it.
      prepare: (chain) => chain.compile(this.runtime.scene, this.camera),
    });
    this.walkLighting = new WalkLightingController({
      build: async () => {
        // The tier in force at build time sets the bake pace, read once per
        // lighting build; the probes' capture edge is the probe atlas's
        // invariant and never varies, and a later tier switch retunes the
        // screen, never the bake.
        const lighting = await loadWalkLighting(this.runtime.renderer, this.runtime.scene, this.quality.tier);
        // The walk's ambient floor is artificial light: it takes the current temperature.
        deps.artificialLights?.(this.runtime.scene);
        return lighting;
      },
      report: (error) => deps.onFrameError?.(error),
      chainReady: () => this.walkPost.state() === 'on',
      document: () => this.lightingDocument?.document() ?? null,
      now: () => performance.now(),
      eye: () => this.camera.position,
      hdri: deps.hdri === undefined ? undefined : { ...deps.hdri, loads: hdriLoads(this.runtime.renderer) },
    });
    this.planModes = new PlanModes({
      container: deps.roots.viewport,
      viewport: deps.viewport,
      runtime: this.runtime,
      perspective: () => this.camera,
      options: deps.planOptions,
      assetFacts: deps.assetFacts,
    });
    this.minimap = new Minimap({
      container: deps.roots.viewport,
      messages: deps.messages,
      drawing: () => this.planModes.planDrawing,
      camera: () => this.marker(),
      enabled: deps.minimapEnabled,
      onRoomPicked: deps.onRoomPicked,
      // The tour cameras as dots in walk and tour; a click steps there.
      cameras: () => ({ points: this.cameraDots(), current: this.cameraDirector?.mapCamera() ?? null }),
      onCameraPicked: (index) => {
        if (this.cameraDirector?.stepCamera(index) !== true) return;
        deps.usage?.('minimap');
        deps.usage?.('camera_step');
      },
      signal: deps.signal,
    });
    // The host's theme on the backdrop and the map before the first frame, not after it.
    this.applyTheme();
    this.walkCameras = new WalkCameraBar({
      container: deps.roots.viewport,
      messages: deps.messages,
      enabled: deps.walkCamerasEnabled,
      onStep: (to) => {
        if (this.cameraDirector?.stepCamera(to) === true) deps.usage?.('camera_step');
      },
      signal: deps.signal,
    });
    this.selection = new ViewerSelectionController({
      canvas: deps.roots.canvas,
      picker: deps.director.picker,
      root: () => this.runtime.scene,
      // The plan modes swap the camera a pick is cast with; the rig is the
      // answer everywhere else (`plan-modes.pickCamera`).
      camera: () => this.planModes.pickCamera(),
      planDoorAt: (clientX, clientY) => this.planModes.doorAt(clientX, clientY),
      mode: () => this.mode,
      emit: deps.selection.emit,
      // `interaction: 'none'` puts `pointer-events: none` on the canvas and
      // attaches no camera input either: a viewer that hears nothing must not
      // hear this either.
      listen: deps.selection.listen && deps.director.interaction !== 'none',
      signal: deps.signal,
    });
    this.scrollHint = new ScrollHint({ container: deps.roots.viewport, messages: deps.messages });
    this.tapHint = new ScrollHint({
      container: deps.roots.viewport,
      messages: deps.messages,
      key: 'hint.tapToLook',
      name: TAP_HINT_NAME,
      once: true,
    });
    deps.dollhouse.setState('dollhouse', this.camera);
  }

  /** What a pointer is cast against: the scene's surfaces and the floor (`geometry/picker.ts`). */
  get picker(): Picker {
    return this.deps.director.picker;
  }

  /** The camera a pointer ray is cast through right now: the top view in the plan modes, the rig elsewhere. */
  pickCamera(): THREE.Camera {
    return this.planModes.pickCamera() ?? this.camera;
  }

  /** The camera stack, `undefined` until the first document seeded it. */
  get director(): CameraDirector | undefined {
    return this.cameraDirector;
  }

  /** The mode on screen, `undefined` before the camera stack exists. */
  get mode(): ViewerMode | undefined {
    return this.cameraDirector?.controller.getMode();
  }

  /**
   * Camera, document root and viewport box of the frame about to be drawn
   * (`slot-anchor.ts`).
   *
   * `root` is a PARAMETER rather than `this.runtime.scene`, because the anchor
   * caches its graph walk against the root's identity and the renderer's scene
   * is the same object for the life of the mount — a commit replaces the
   * document GROUP inside it (`geometry/scene-builder.ts`). The stage does not
   * know the mount, so the frame hook that has both hands it over
   * (`viewer-frame.ts`).
   */
  anchorScene(root: THREE.Object3D | undefined): AnchorScene {
    return {
      camera: anchorCamera(this.planModes, this.camera),
      root,
      viewport: { width: this.deps.viewport.clientWidth, height: this.deps.viewport.clientHeight },
    };
  }

  /**
   * Adopts a committed document: builds the camera stack on the first one and
   * re-seeds it on every later one, and hands the plan to the map and the
   * authoring tools.
   */
  setDocument(model: SceneModel, root: () => THREE.Object3D | undefined = () => undefined): void {
    this.planModes.setDocument(model.plan, model.scene);
    // The room lighting loads this document on its next walk frame and refreshes after its edits.
    this.lightingDocument?.off();
    this.lightingDocument = wireWalkLighting(this.walkLighting, model, root);
    this.minimap.setDocument();
    this.authoringHooks?.document(model.scene);
    // A rebuild handed out new meshes; the host's highlight follows the target
    // it named, or goes quietly when the target is gone (`selection.ts`).
    this.selection.reapply();
    if (this.cameraDirector) {
      this.cameraDirector.setScene(model.scene, model.plan);
      return;
    }
    this.cameraDirector = mountCameraDirector({
      ...this.deps.director,
      camera: this.camera,
      canvas: this.deps.roots.canvas,
      keys: this.deps.roots.root,
      dollhouse: this.deps.dollhouse,
      planModes: this.planModes,
      signal: this.deps.signal,
      usage: this.deps.usage,
      onScrollThrough: () => this.scrollHint.show(),
      onSwipeThrough: () => this.tapHint.show(),
      onPress: () => this.tapHint.hide(),
      onWalkCamera: (camera) => {
        this.walkCameras.setCamera(camera);
        this.deps.director.onWalkCamera?.(camera);
      },
    });
    this.walkCameras.setCamera(this.cameraDirector.walkCamera());
    // The walk floor ring is the controller's; the render scene is the stage's.
    this.runtime.scene.add(this.cameraDirector.controller.floorRing.object);
  }

  /**
   * The mini-map, brought up to date: the mode it should be showing for, and
   * one repaint if anything visible moved. Called once before the first frame
   * and once per frame after that, so a mode reached by any route at all — a
   * button, a room focus, a manual grab mid-tour — lands on the card.
   */
  /** Placements changed without a rebuild: the walk's obstacles and the plan's selection mark follow. */
  placementsChanged(scene: SceneData): void {
    this.cameraDirector?.controller.refreshObstacles(scene);
    this.planModes.placementsChanged(scene);
  }

  /**
   * An opening changed without a rebuild (a variant swap): the 2D plan and the
   * mini-map draw its leaves and arcs from the document, so they are drawn
   * again. The rest of `setDocument` (lighting, camera, selection) is a plan's
   * business and stays untouched.
   */
  openingsChanged(model: SceneModel): void {
    this.planModes.setDocument(model.plan, model.scene);
    this.minimap.setDocument();
  }

  syncMinimap(): void {
    const mode = this.mode;
    if (mode) this.minimap.setMode(mode);
    this.minimap.update();
  }

  /** Starts the frame loop, with the camera and the tour on the first hook. */
  start(hooks: readonly FrameHook[]): void {
    bindStageFrame(
      this.runtime,
      {
        camera: (delta) => this.cameraDirector?.controller.update(delta),
        tour: (delta) => {
          // The clip in `tour`, the entry glide and the camera steps in `walk` (`CameraDirector.updateTour`).
          this.cameraDirector?.updateTour(delta);
          this.walkCameras.setMode(this.mode);
          const mode = this.mode;
          // Walk and tour render through the chain, once it has loaded.
          this.walkPost.update(mode);
          // Walk and tour see and are lit by the daylight sky and the lit ground, never the host's backdrop: before the bake below.
          this.syncDaylight();
          // The room lighting bakes after the chain is attached and shows once baked;
          // a change of its look is a new picture in walk and tour.
          if (this.walkLighting.update(mode)) this.runtime.demand.invalidate();
        },
        authoring: () => this.authoringHooks,
      },
      hooks,
    );
    // The quality machine feeds on drawn frames: a POST-render hook knows the
    // tick drew (`lastDrawnAt` is this tick's own reading) and runs after the
    // draw, outside the frame's GL state. A skipped tick breaks the interval
    // instead of stretching it: demand said "no draw", never that the device
    // was slow, so sporadic draws read as no motion, not as slow motion.
    this.runtime.addPostRenderHook((_delta, now) => {
      if (this.runtime.lastDrawnAt === now) this.quality.drawn(now);
      else this.quality.skipped();
    });
    this.runtime.start();
  }

  /** Binds (or, with `null`, unbinds) the authoring tools' frame hooks (`bindStageFrame` runs them). */
  setAuthoring(hooks: StageAuthoringHooks | null): void {
    this.authoringHooks = hooks;
  }

  /** The chain a still or video frame taken now renders through (`capture-commands.ts`). */
  captureChain(): Promise<PostProcessor | null> {
    return this.walkPost.forCapture(this.mode);
  }

  /**
   * Runs a camera-view capture (a room or tour camera, a panorama, tour frames)
   * under the daylight sky walk and tour look out at, whatever the mode on
   * screen: a room photographed from 360 or plan shows the windows as a walk
   * shows them, not the host's backdrop. The live view shows that sky while it
   * runs, and the mode's own the moment the last capture is done.
   */
  async underDaylightSky<T>(take: () => Promise<T>): Promise<T> {
    this.daylightCaptures += 1;
    this.syncDaylight();
    try {
      return await take();
    } finally {
      this.daylightCaptures -= 1;
      this.syncDaylight();
    }
  }

  /** Gives a root built offscreen for a capture the ground look the live scene has now (`capture-commands.ts`). */
  groundLike(root: THREE.Object3D): void {
    setSiteGroundLit(findSiteGround(root), this.daylightSky());
  }

  /** Whether the sky is the daylight one now: in walk and tour, and while a camera-view capture runs. */
  private daylightSky(): boolean {
    const mode = this.mode;
    return mode === 'walk' || mode === 'tour' || this.daylightCaptures > 0;
  }

  /**
   * The daylight sky and the lit ground together, or the host's backdrop with
   * the ground as a shadow catcher over it (`geometry/site-ground.ts`). The
   * ground is looked up again only when a rebuild replaced it.
   */
  private syncDaylight(): void {
    const daylight = this.daylightSky();
    this.runtime.setDaylightSky(daylight);
    if (this.siteGround === null || !isUnder(this.siteGround, this.runtime.scene)) this.siteGround = findSiteGround(this.runtime.scene);
    setSiteGroundLit(this.siteGround, daylight);
  }

  /** Re-measures the container; normally the `ResizeObserver` has already. */
  resize(): void {
    this.runtime.resize();
  }

  /** The tour cameras' plan points for the mini-map, derived once per committed camera list (it asks every frame). */
  private cameraDots(): readonly { x: number; z: number }[] {
    const cameras = this.deps.tourCameras();
    if (cameras !== this.dotsFor) {
      this.dotsFor = cameras;
      this.dots = (cameras ?? []).map((camera) => ({ x: camera.position.x, z: camera.position.z }));
    }
    return this.dots;
  }

  /** Where the camera stands and looks, as the mini-map's marker. */
  private marker(): { x: number; z: number; yaw: number; fov: number } | null {
    const controller = this.cameraDirector?.controller;
    return controller ? cameraMarker(this.camera, controller.getPose()) : null;
  }

  /**
   * Hands the root's resolved theme to what CSS cannot colour
   * (`ui/theme-colour.ts`): the runtime's backdrop and the mini-map's canvas.
   */
  applyTheme(): void {
    const root = this.deps.roots.root;
    this.runtime.setBackdrop(resolveBackdrop(root));
    this.minimap.setAccent(resolveThemeColour(root, '--jeex-minimap-accent', DEFAULT_MINIMAP_ACCENT));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runtime.stop();
    this.cameraDirector?.controller.dispose();
    this.planModes.dispose();
    this.minimap.dispose();
    this.walkCameras.dispose();
    this.selection.dispose();
    this.scrollHint.dispose();
    this.tapHint.dispose();
    this.lightingDocument?.off();
    this.walkLighting.dispose();
    this.walkPost.dispose();
    this.runtime.dispose();
    // The runtime left this canvas's context lost for good: the next boot draws on a fresh one.
    replaceSceneCanvas(this.deps.roots);
  }
}
