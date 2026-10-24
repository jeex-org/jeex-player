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
import { mountCameraDirector, type CameraDirector, type CameraStackDeps } from '../camera/camera-director.js';
import { AUTHORING_MODES, CheckpointOverlay } from '../camera/checkpoint-overlay.js';
import { CheckpointPilot } from '../camera/checkpoint-pilot.js';
import { LookThroughBar } from '../ui/look-through-bar.js';
import { WalkCameraBar } from '../ui/walk-camera-bar.js';
import type { CheckpointEdit, CheckpointSelect } from '../camera/checkpoint-overlay.js';
import type { TourNavigation } from '../navigation/tour-legs.js';
import type { Obstacle } from '../navigation/navigation.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData, TourCheckpoint } from '../scene/types.js';
import { CameraPreview } from '../ui/camera-preview.js';
import { PlanModes, type PlanModeOptions } from '../ui/plan-modes.js';
import { Minimap } from '../ui/minimap.js';
import { ScrollHint } from '../ui/scroll-hint.js';
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
import type { AssetMoveControl } from '../edit/asset-move-session.js';
import { loadWalkPost, WalkPostController } from './walk-post-controller.js';
import { loadWalkLighting, WalkLightingController } from './walk-lighting-controller.js';
import { wireWalkLighting } from './walk-lighting-wiring.js';
import type { WalkDocument } from '../render/walk-lighting/walk-lighting.js';
import type { PostProcessor } from '../render/post-processor.js';

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
  /**
   * `options.select` and the sink for the `select` event (`app/selection.ts`).
   * `listen: false` attaches no pointer listener at all; the controller is
   * still built, so `ViewerHandle.setSelection` works whatever the option says
   * — the option gates the EVENT, not the host's own command.
   */
  selection: { listen: boolean; emit: (selection: ViewerSelection) => void };
  /**
   * The tour-camera placement overlay (`camera/checkpoint-overlay.ts`): the
   * host's on/off switch, the two sinks for its events, and the two reads the
   * overlay needs of the document — the committed scene and its revision —
   * plus the committed plan's walkable space its trajectory walks through,
   * the plan and furniture its placements stand on, and the host commands its
   * own buttons raise (`checkpoints-wiring.ts`). The stage itself never reads
   * the scene (its header invariant); it passes these through and hands the
   * overlay a new document in `setDocument`.
   */
  checkpoints: StageCheckpoints;
  /**
   * The director's wiring, minus what the stage supplies (camera, canvas, keys,
   * ui). Carries `interaction` (`director-wiring.ts`): `'none'`
   * sets `pointer-events: none` on the canvas (below) AND is threaded to
   * `mountCameraDirector` so `CameraInput` is never attached; `'passive'` only
   * does the latter. Default `'full'`.
   */
  director: Omit<CameraStackDeps, 'camera' | 'canvas' | 'keys' | 'messages' | 'dollhouse' | 'planModes' | 'onScrollThrough'>;
};

/** The tour-camera tool's reads and sinks (`checkpoints-wiring.ts` assembles them). */
export type StageCheckpoints = {
  enabled: () => boolean;
  scene: () => SceneData | null;
  /** The committed plan's walkable space, for the trajectory the tube draws; `null` before the first document. */
  navigation: () => TourNavigation | null;
  /** The committed plan, for the floor rules of placement and moves. */
  plan: () => SolvedPlan | null;
  /** The committed furniture footprints a placement steps off. */
  obstacles: () => readonly Obstacle[];
  rev: () => number;
  pose: () => { position: THREE.Vector3; target: THREE.Vector3 } | null;
  onSelect: (selection: CheckpointSelect) => void;
  onEdit: (edit: CheckpointEdit) => void;
  onPlacing: (active: boolean) => void;
  frame: (checkpoint: TourCheckpoint) => void;
  lookThrough: (id: string) => void;
  endLookThrough: (commit: boolean) => void;
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
 * The camera a host anchor projects through: the one the mode DRAWS with.
 *
 * In `plan3d` that is the plan's top view, not the perspective rig, which the
 * plan modes freeze where the last 3D mode left it — projecting through the
 * rig placed a host editor's selection card where the object had been in
 * orbit. The checkpoint overlay draws through
 * the same `activeCamera()`.
 */
export function anchorCamera(planModes: Pick<PlanModes, 'activeCamera'>, perspective: THREE.Camera): THREE.Camera {
  return planModes.activeCamera() ?? perspective;
}

export class ViewerStage {
  private readonly deps: ViewerStageDeps;
  readonly runtime: RenderRuntime;
  readonly camera: THREE.PerspectiveCamera;
  readonly planModes: PlanModes;
  readonly minimap: Minimap;
  /**
   * The tour-camera overlay. Built BEFORE the selection controller on purpose:
   * both listen on the same canvas, and a grab the overlay claims answers with
   * `stopImmediatePropagation`, which only reaches listeners registered after
   * it — the camera input included (the director is built per document).
   */
  readonly overlay: CheckpointOverlay;
  /**
   * The overlay's parent in the render scene: the host's switch lives on the
   * overlay's own group, the MODE's on this one (the authoring
   * rig is hidden in `walk` and `tour`), so leaving `walk` restores exactly
   * what the switch says without either side remembering the other.
   */
  private readonly authoring = new THREE.Group();
  readonly preview: CameraPreview;
  /** «Look through»: holds the piloted camera's height over the walk rig (`camera/checkpoint-pilot.ts`). */
  readonly pilot: CheckpointPilot;
  /** The look-through's own «Done»/«Cancel» (`ui/look-through-bar.ts`). */
  readonly lookThrough: LookThroughBar;
  /** The walk's Previous/Next camera buttons and index (`ui/walk-camera-bar.ts`). */
  readonly walkCameras: WalkCameraBar;
  /** The mini-map's camera dots and the list they were derived from (`cameraDots`). */
  private dotsFor: readonly TourCheckpoint[] | undefined;
  private dots: readonly { x: number; z: number }[] = [];
  readonly selection: ViewerSelectionController;
  /** «Ctrl + scroll to zoom», shown when a plain wheel went to the page. */
  readonly scrollHint: ScrollHint;
  private cameraDirector?: CameraDirector;
  /** The walk and tour post-processing chain: loaded on demand, attached in those modes (`walk-post-controller.ts`). */
  readonly walkPost: WalkPostController;
  /** The walk and tour room lighting: built after the chain, baked on entry (`walk-lighting-controller.ts`). */
  readonly walkLighting: WalkLightingController;
  /** The document the room lighting is built for, and the end of its edit subscription. */
  private lightingDocument: { document: () => WalkDocument | null; off: () => void } | null = null;
  private disposed = false;
  /** The asset move tool's switch, once `handle.setAssetMoveTool` was first called (`asset-move-wiring.ts`). */
  assetMove: AssetMoveControl | null = null;

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
    this.runtime = createRenderRuntime({
      canvas: deps.roots.canvas,
      viewport: deps.viewport,
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
      // Walk and tour draw on demand (`render/render-demand.ts`).
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
      build: () => loadWalkPost(this.runtime.renderer, this.runtime.scene, this.camera),
      attach: (chain) => this.runtime.setPostProcessor(chain),
      report: (error) => deps.onFrameError?.(error),
      // The scene's programs for the chain's own target, linked before the first frame through it.
      prepare: (chain) => chain.compile(this.runtime.scene, this.camera),
    });
    this.walkLighting = new WalkLightingController({
      build: async () => {
        const lighting = await loadWalkLighting(this.runtime.renderer, this.runtime.scene);
        // The walk's ambient floor is artificial light: it takes the current temperature.
        deps.artificialLights?.(this.runtime.scene);
        return lighting;
      },
      report: (error) => deps.onFrameError?.(error),
      chainReady: () => this.walkPost.state() === 'on',
      document: () => this.lightingDocument?.document() ?? null,
      now: () => performance.now(),
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
      cameras: () => ({ points: this.cameraDots(), current: this.cameraDirector?.walkCamera().index ?? null }),
      onCameraPicked: (index) => {
        if (this.cameraDirector?.stepCamera(index) !== true) return;
        deps.usage?.('minimap');
        deps.usage?.('camera_step');
      },
      signal: deps.signal,
    });
    this.walkCameras = new WalkCameraBar({
      container: deps.roots.viewport,
      messages: deps.messages,
      enabled: deps.walkCamerasEnabled,
      onStep: (to) => {
        if (this.cameraDirector?.stepCamera(to) === true) deps.usage?.('camera_step');
      },
      signal: deps.signal,
    });
    const checkpoints = deps.checkpoints;
    this.overlay = new CheckpointOverlay({
      canvas: deps.roots.canvas,
      camera: () => this.camera,
      drawCamera: () => this.planModes.activeCamera(),
      // Rays through the camera object selection casts with: the top view in plan3d.
      rayCamera: () => this.rayCamera(),
      mode: () => this.mode ?? 'plan2d',
      scene: checkpoints.scene,
      navigation: checkpoints.navigation,
      plan: checkpoints.plan,
      obstacles: checkpoints.obstacles,
      floorPoint: (clientX, clientY) => deps.director.picker.floorPoint(clientX, clientY, this.rayCamera() ?? this.camera),
      keys: deps.roots.root,
      container: deps.roots.viewport,
      frame: checkpoints.frame,
      rev: checkpoints.rev,
      enabled: checkpoints.enabled,
      pose: checkpoints.pose,
      onSelect: checkpoints.onSelect,
      onEdit: checkpoints.onEdit,
      onPlacing: checkpoints.onPlacing,
      // The editing modes draw on demand: every change of the rig is a new picture.
      onChange: () => this.runtime.demand.invalidate(),
      signal: deps.signal,
    });
    this.pilot = new CheckpointPilot({
      camera: this.camera,
      keys: deps.roots.root,
      onKeyEnd: checkpoints.endLookThrough,
      signal: deps.signal,
    });
    this.lookThrough = new LookThroughBar({
      container: deps.roots.viewport,
      messages: deps.messages,
      onEnd: checkpoints.endLookThrough,
      signal: deps.signal,
    });
    this.authoring.name = 'tourAuthoring';
    this.authoring.visible = false;
    this.authoring.add(this.overlay.group);
    this.runtime.scene.add(this.authoring);
    this.overlay.setEnabled(deps.checkpoints.enabled());
    this.preview = new CameraPreview({
      container: deps.roots.viewport,
      root: deps.roots.root,
      scene: () => this.runtime.scene,
      renderer: () => this.runtime.renderer,
      overlay: () => this.overlay,
      mode: () => this.mode,
      messages: deps.messages,
      onLookThrough: checkpoints.lookThrough,
      onChange: () => this.runtime.demand.invalidate(),
      onInsetDrawn: () => this.runtime.demand.insetDrawn(),
      signal: deps.signal,
    });
    // The inset is drawn over the main picture, and only over one that was
    // just drawn: a skipped tick presents the last picture, inset included.
    this.runtime.addPostRenderHook(() => this.preview.drawAfter(this.runtime.demand.counters().draws));
    this.selection = new ViewerSelectionController({
      canvas: deps.roots.canvas,
      picker: deps.director.picker,
      root: () => this.runtime.scene,
      // The plan modes swap the camera a pick is cast with; the rig is the
      // answer everywhere else (`plan-modes.pickCamera`).
      camera: () => this.planModes.pickCamera(),
      mode: () => this.mode,
      emit: deps.selection.emit,
      // `interaction: 'none'` puts `pointer-events: none` on the canvas and
      // attaches no camera input either: a viewer that hears nothing must not
      // hear this either.
      listen: deps.selection.listen && deps.director.interaction !== 'none',
      signal: deps.signal,
    });
    this.scrollHint = new ScrollHint({ container: deps.roots.viewport, messages: deps.messages });
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
   * re-seeds it on every later one, and hands the plan to the overlay and the
   * map.
   */
  setDocument(model: SceneModel, root: () => THREE.Object3D | undefined = () => undefined): void {
    this.planModes.setDocument(model.plan, model.scene);
    // The room lighting loads this document on its next walk frame and refreshes after its edits.
    this.lightingDocument?.off();
    this.lightingDocument = wireWalkLighting(this.walkLighting, model, root);
    this.minimap.setDocument();
    // The overlay rebuilds from the committed list; an active focus survives
    // when the document still carries its checkpoint.
    this.overlay.setScene(model.scene);
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
      messages: this.deps.messages,
      dollhouse: this.deps.dollhouse,
      planModes: this.planModes,
      signal: this.deps.signal,
      usage: this.deps.usage,
      onScrollThrough: () => this.scrollHint.show(),
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
  syncMinimap(): void {
    const mode = this.mode;
    if (mode) this.minimap.setMode(mode);
    this.minimap.update();
  }

  /** Starts the frame loop, with the camera and the tour on the first hook. */
  start(hooks: readonly FrameHook[]): void {
    const cameraHook: FrameHook = (delta) => {
      this.cameraDirector?.controller.update(delta);
      // A look-through holds the camera's own height over the walk rig's eye.
      this.pilot.update();
      // The clip in `tour`, the entry glide and the camera steps in `walk` (`CameraDirector.updateTour`).
      this.cameraDirector?.updateTour(delta);
      this.walkCameras.setMode(this.mode);
      // Read per frame, like the mini-map's mode: a mode reached by any route
      // (a button, a manual grab mid-tour) hides or restores the rig.
      const mode = this.mode;
      this.authoring.visible = mode !== undefined && AUTHORING_MODES.has(mode);
      // Size floor, constant-size handles and badges, for the pose just set.
      this.overlay.frame();
      // Walk and tour render through the chain, once it has loaded.
      this.walkPost.update(mode);
      // The room lighting bakes after the chain is attached and shows once baked;
      // a change of its look is a new picture in walk and tour.
      if (this.walkLighting.update(mode)) this.runtime.demand.invalidate();
    };
    // Last, before the draw decision: the overlay's cheap transforms are applied
    // live during a drag, the expensive tube rebuild is deferred to here, once
    // per tick, so the frame drawn now shows the finished trajectory; then the
    // preview card syncs and asks for a frame if its picture changed.
    const frameEnd: FrameHook = () => {
      this.overlay.flush();
      this.preview.sync();
    };
    for (const hook of [...orderFrameHooks(cameraHook, hooks), frameEnd]) this.runtime.addFrameHook(hook);
    this.runtime.start();
  }

  /** The chain a still or video frame taken now renders through (`capture-commands.ts`). */
  captureChain(): Promise<PostProcessor | null> {
    return this.walkPost.forCapture(this.mode);
  }

  /** Re-measures the container; normally the `ResizeObserver` has already. */
  resize(): void {
    this.runtime.resize();
  }

  /** The tour cameras' plan points for the mini-map, derived once per committed camera list (it asks every frame). */
  private cameraDots(): readonly { x: number; z: number }[] {
    const cameras = this.deps.checkpoints.scene()?.tourCheckpoints;
    if (cameras !== this.dotsFor) {
      this.dotsFor = cameras;
      this.dots = (cameras ?? []).map((camera) => ({ x: camera.position.x, z: camera.position.z }));
    }
    return this.dots;
  }

  /** The camera a pointer ray is cast through right now (`PlanModes.pickCamera`), as the overlay's camera type. */
  private rayCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined {
    const camera = this.planModes.pickCamera();
    return camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera ? camera : undefined;
  }

  /** Where the camera stands and looks, as the mini-map's marker. */
  private marker(): { x: number; z: number; yaw: number; fov: number } | null {
    const controller = this.cameraDirector?.controller;
    return controller ? cameraMarker(this.camera, controller.getPose()) : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runtime.stop();
    this.cameraDirector?.controller.dispose();
    this.planModes.dispose();
    this.minimap.dispose();
    this.preview.dispose();
    this.pilot.dispose();
    this.lookThrough.dispose();
    this.walkCameras.dispose();
    this.runtime.scene.remove(this.authoring);
    this.assetMove?.dispose();
    this.overlay.dispose();
    this.selection.dispose();
    this.scrollHint.dispose();
    this.lightingDocument?.off();
    this.walkLighting.dispose();
    this.walkPost.dispose();
    this.runtime.dispose();
  }
}
