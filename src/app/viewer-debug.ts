/**
 * `window.__viewerDebug`: the contract `scripts/browser-check.ts` drives the
 * viewer through. It is the only sanctioned way for automation to read viewer
 * state, so every entry here is a contract: renaming, removing or reshaping
 * one breaks the browser checks that read it.
 *
 * Invariant: the finish and variant getters project the `SceneModel`, never the
 * meshes. What `exportScene()` writes and what the viewer renders therefore
 * cannot drift apart, which is what makes the export round trip meaningful.
 * `plan()` is the solved plan, so a browser check derives click coordinates
 * from the geometry instead of hard-coding metres or pixels. Its DTOs are
 * CLONED: the committed plan is frozen and must not be handed out by reference.
 *
 * Capability invariant: the read-only diagnostics are always installed; the
 * three that CHANGE or EXPORT the draft (`applyOps`, `exportScene`,
 * `loadScene`) only exist in a development build or when the page is opened
 * with `?debug=1`. A production page therefore exposes no way to edit or
 * exfiltrate the document through the global.
 */

import type { SunShadow, SunShadowState } from '../render/sun-shadow.js';
import * as THREE from 'three';
import { projectToViewport } from '../render/viewport-projection.js';
import type { Messages } from '../ui/messages.js';
import type { SceneModel, ApplyResult } from '../scene/scene-model.js';
import type { SceneOp } from '../scene/scene-ops.js';
import { facadeFinishOf, faceFinishOf, floorFinishOf, roomWallFinishOf } from '../scene/scene-ops.js';
import type { AssetFactsSource } from '../assets/asset-facts.js';
// Type-only: `layout-lint.ts` itself is loaded lazily, only for a page that
// has the debug capability on, so a production bundle never pays for it.
import type { LayoutCatalogue, LayoutIssue } from '../layout/layout-lint.js';
// Type-only for the same reason, and lazy in its own right: `free-space.ts`
// is a second lazy chunk that imports across into `layout-lint`'s (measured
// sizes are on `loadLayoutModules`, `debug-layout-modules.ts`).
import type { PlacementSuggestion } from '../layout/free-space.js';
import type { ProjectLibraryManifest } from '../assets/project-manifest.js';
import type { OpeningListEntry } from '../geometry/opening-builder.js';
import type { DoorRecord } from '../doors/door-state.js';
import type { CameraDirector } from '../camera/camera-director.js';
import type { ViewerEditor } from './viewer-editor.js';
import { FURNITURE_GROUP_NAME, type SceneBuilder } from '../geometry/scene-builder.js';
import { countTriangles } from '../geometry/model-source.js';
import type { TourControls, TourDebugControls } from '../camera/tour-controls.js';
import { checkCompleteness } from '../scene/completeness.js';
import type { FaceKey, SceneData, Vec2 } from '../scene/types.js';
import type { SceneReport } from '../scene/scene-report.js';
import type { ViewerSelection, ViewerSelectionTarget } from './selection.js';
import type { SelectionDescription } from '../ui/selection-options.js';
import type { AssetMoveDebug } from '../edit/asset-move-session.js';
import type { WalkPostState } from './walk-post-controller.js';
import type { HdriDebug, WalkLightingState } from './walk-lighting-controller.js';
import type { WalkLightingStats } from '../render/walk-lighting/walk-lighting.js';
import type { DemandCounters } from '../render/render-demand.js';
import type { LightBakeState } from '../lightmap/light-bake-wiring.js';
import type { QualityDebug } from '../render/quality-tier.js';

import { freeSpaceModule, layoutLintModule, loadLayoutModules } from './debug-layout-modules.js';
import { planDebugDto, planDrawingCounts } from './viewer-debug-plan.js';

/** The room lighting as the debug surface reads it. */
type WalkLightingDebug = { state: WalkLightingState; stats: WalkLightingStats | null };

/** What `__viewerDebug.minimap()` answers (`minimap.ts`). */
type MinimapState = {
  visible: boolean;
  camera: { x: number; z: number; yaw: number } | null;
  hoverRoom: string | null;
};

/**
 * One waypoint of a walk route, as the debug surface hands it out: plan metres
 * plus the `door` tag `room-graph.ts` puts on the two standoff points of a
 * doorway. The tag is what lets a browser check name the door a route crosses
 * without knowing the apartment (`scripts/browser-check.ts`).
 */
type DebugRoutePoint = Vec2 & { door?: string | undefined };

type ViewerDebugApi = {
  mode: () => string | undefined;
  camera: () => { x: number; y: number; z: number } | null;
  /**
   * Where the camera LOOKS, as the tour checkpoints speak it: yaw 0 = +Z,
   * positive toward +X, pitch positive up, radians. With `camera()` this is
   * the whole pose, which is what a browser check compares against a tour
   * camera to prove the run starts, passes and ends on it.
   */
  cameraLook: () => { yaw: number; pitch: number } | null;
  /**
   * The tour-camera overlay as drawn (`camera/checkpoint-overlay.ts`): whether
   * the host switched it on, whether it is actually rendered (on, in the
   * render scene, and not in the 2D plan whose renderer is off), the marker
   * ids and whether the trajectory tube is up.
   */
  tourCameras: () => { visible: boolean; rendered: boolean; markers: string[]; tube: boolean };
  children: () => string[];
  /**
   * Names of the wall-joint cores in the built root (`joint-<nodeId>`), the
   * meshes that make every junction watertight. A shell rebuild that forgot
   * them would leave the corners open again, which is exactly what this
   * getter lets a browser check assert.
   */
  wallJoints: () => string[];
  rooms: () => string[];
  furniture: () => boolean;
  /**
   * Whether the built furniture container is actually RENDERED
   * (`Object3D.visible`), as opposed to what the app's toggle believes.
   * `null` before a root exists. The two can only disagree through a bug; this
   * guards against a shell rebuild introducing one.
   */
  furnitureRendered: () => boolean | null;
  /** The sun: direction, its world angles, the fitted frustum and how often its cached map was drawn; `null` before a root. */
  sunShadow: () => SunShadowState | null;
  /** The walk and tour post-processing chain: `off`, `loading`, `on` (drawing the frame) or `failed`. */
  walkPost: () => WalkPostState;
  /** The walk and tour room lighting: its phase and the last full bake's measurement (`walk-lighting-controller.ts`). */
  walkLighting: () => WalkLightingDebug;
  /**
   * The host sky (`lighting.hdri`): `off`, `loading`, `ready` (installed, waiting for the room lighting's swap),
   * `live`, `sky-only` (over a light bake) or `failed`, with the preset, cube size and sun intensity (`walk-lighting-controller.ts`).
   */
  hdri: () => HdriDebug;
  /** The render quality tier in force: the mode (`auto` runs the frame-time machine, `fixed` pins) and the tier it answers with (`quality-control.ts`). */
  quality: () => QualityDebug;
  /**
   * Cumulative frame-loop ticks and display draws (`render/render-demand.ts`):
   * a resting view keeps ticking while its draws stay flat; `insetDraws`
   * counts the camera-preview inset, drawn only after a main draw.
   */
  renderDemand: () => DemandCounters;
  /** The page's offline light bake (`__JEEX_DEBUG_LIGHT_BAKE__`): `off`, `waiting`, `loading`, `applied`, `refused` or `dropped`. */
  lightBake: () => LightBakeState;
  /**
   * What every furniture body on screen actually IS, right now: the placement
   * id, whether its body is procedural, a `dims` stand-in waiting for a GLB or
   * the GLB itself, and how many triangles it is drawing.
   *
   * The one thing a baked project cannot be checked without: the
   * first frame is stand-ins and the GLBs arrive afterwards, and "the model
   * replaced the placeholder" is a claim about the SCENE GRAPH that no
   * screenshot and no document read can make. Ungated, like `furniture` and
   * `openings`: it reports what is drawn and changes nothing.
   */
  assetModels: () => Array<{ id: string; state: string; degraded?: string; triangles: number }>;
  /**
   * The colour, map slots and colour-map size the shell mesh `name` is drawn with now (a library surface gains maps late); ungated.
   * `colour` is the material's colour factor as `#rrggbb`, each channel clamped to 1: a tintable scan's factor
   * (tint times its recipe gain, which undoes the tint map's mid-grey mean) reads near white once its map arrives.
   */
  surfaceMaterial: (name: string) => { colour: string; maps: string[]; mapSize: number | null } | null;
  selectedFurniture: () => string | null;
  assetVariant: (id: string) => string | null;
  selectedOpening: () => string | null;
  openingVariant: (id: string) => string | null;
  openings: () => OpeningListEntry[];
  /**
   * Interior presets the scene offers and which one is in force. Ungated with
   * `applyPreset`: applying a preset is a USER-level action — the same one the
   * panel performs — not an authoring capability like `applyOps`.
   */
  presets: () => Array<{ id: string; name: string; active: boolean }>;
  applyPreset: (presetId: string) => ApplyResult;
  floorFinish: (roomId: string) => string | null;
  wallFinish: (roomId: string) => string | null;
  faceWall: (face: FaceKey) => string | null;
  faces: (roomId: string) => FaceKey[];
  facadeWall: () => string | null;
  /**
   * The tour clip as `TourControls` minus `on`: `progress()`, `play`, `pause`,
   * `toggle`, `stop`, `seek`, `seekDistance`, `seekTime`. Always installed —
   * these calls change only the camera, never the scene — so a browser check
   * can scrub the run without `?debug=1`. Absent only before the viewer mounts.
   */
  tour?: TourDebugControls;
  /**
   * Door VIEW state: `{ id, phase, t }` per interactive door, and the two calls
   * that drive it. UNGATED like `tour`: shutting a door moves leaves and blocks
   * a walk, it never touches the draft, so a production page exposes them too.
   * `doorScreenPoint` is what lets a browser check hover a door without
   * hard-coding pixels.
   */
  doors: () => DoorRecord[];
  /**
   * What the door automation makes of the CURRENT camera pose:
   * `{ hold, release }`, the two lists `door-animator` applies every frame
   * (`door-state.doorAutomation`). A pure query — asking changes nothing — and
   * `{ hold: [], release: [] }` in the modes the automation does not run in, so
   * a browser check can tell "the walker is too far" from "the automation is
   * off" without watching for a leaf to move.
   */
  doorAutomation: () => { hold: string[]; release: string[] };
  toggleDoor: (openingId: string) => boolean;
  doorScreenPoint: (openingId: string) => { x: number; y: number } | null;
  /**
   * The mini-map of the walk and tour modes (`minimap.ts`), read-only and
   * UNGATED like the door and tour surfaces: `minimap()` reports whether the
   * card is up, where the marker stands and which room is lit;
   * `minimapRoomPoint` turns a room id into the viewport pixel to point at, so
   * a browser check hovers and clicks the map without hard-coding one;
   * `routeToRoom` is the walk a click would start, waypoints in plan metres,
   * and `travelPath` is the curve the camera actually follows along it
   * (`travel-path.ts`): equal-arc-length samples plus the total length.
   */
  minimap: () => MinimapState;
  minimapRoomPoint: (roomId: string) => { x: number; y: number } | null;
  routeToRoom: (roomId: string) => DebugRoutePoint[] | null;
  travelPath: (roomId: string) => { length: number; points: Vec2[] } | null;
  /**
   * Ends a running scripted travel on the spot, exactly as a second mini-map
   * click on the room already being walked to would: the camera
   * jumps to the end of the curve and the route ends, `onDone` included.
   * `false` when nothing is travelling. Read-only in effect on the DRAFT —
   * it only moves the camera — so UNGATED like `tour` and the door calls.
   */
  finishTravel: () => boolean;
  /** Monotonic scene revision; advances by one per committed batch. */
  revision: () => number;
  /**
   * Whether walk mode could stand at `(x, z)` and whether the camera could
   * walk there right now (furniture included). `null` before the camera exists.
   */
  navigable: (x: number, z: number) => { standable: boolean; reachable: boolean } | null;
  /**
   * Exportable draft of the current scene (`SceneModel.toJSON`).
   * Development / `?debug=1` only.
   */
  exportScene?: () => SceneData;
  /**
   * IDS-style completeness report over the current document
   * (`scene/completeness.ts`): every finding is `info` or `warning`, never a
   * throw. Gated like `exportScene` — it reads the draft as freely as an
   * export would. Development / `?debug=1` only.
   */
  completeness?: () => SceneReport;
  /** Dispatches a batch against the current revision. Development / `?debug=1` only. */
  applyOps?: (ops: SceneOp[]) => ApplyResult;
  /**
   * Validates a document and remounts the viewer on it, so a check can export
   * a painted draft and prove it reloads to the same render.
   * Development / `?debug=1` only.
   */
  loadScene?: (input: unknown) => boolean;
  /**
   * What the viewer last REPORTED and what the host asked it to highlight
   * (`app/selection.ts`). Ungated, like `plan` and `openings`: it reads state
   * and changes nothing. `last` is `null` until the first click with
   * `options.select` on.
   */
  selection: () => { last: ViewerSelection | null; highlight: ViewerSelectionTarget | null };
  /** The asset move tool: armed, loaded, and its gesture state; read-only. */
  assetMove: () => AssetMoveDebug;
  /**
   * Viewport pixels of a plan point AS THE PICK SEES IT — through the camera
   * a click is cast with, which in both plan modes is the fitted top view
   * (`ui/plan-modes.pickCamera`). `projectPoint` answers for the perspective
   * rig and is therefore the wrong answer in `plan2d`. `null` when there is no
   * camera yet or the point is behind it.
   */
  selectionPoint: (x: number, z: number) => { x: number; y: number } | null;
  /**
   * `ViewerHandle.describeSelection` on the debug surface: what the viewer's
   * own panel would show for a selection, as data.
   *
   * Ungated, like `selection` and `openings`: it reads the document and the
   * catalogues, opens nothing and commits nothing — a browser check drives it
   * with `edits=off`, where there is no panel to read instead. `null` before
   * the first document, and for a selection with nothing to offer.
   */
  describeSelection: (target: ViewerSelection) => SelectionDescription | null;
  plan: () => {
    rooms: Array<{
      id: string;
      bbox: { minX: number; maxX: number; minZ: number; maxZ: number };
      polygon: Array<{ x: number; z: number }>;
    }>;
    facadeWalls: Array<{
      face: FaceKey;
      wallId: string;
      centre: { x: number; z: number };
      outward: { x: number; z: number };
      length: number;
    }>;
  };
  projectPoint: (x: number, y: number, z: number) => { x: number; y: number } | null;
  focusRoom: (roomId: string) => boolean;
  floorPoint: (x: number, y: number) => { x: number; y: number; z: number } | null;
  projectFloorPoint: (x: number, z: number) => { x: number; y: number } | null;
  /**
   * The room whose FLOOR mesh lies under the plan point `(x, z)`, found by
   * casting a ray straight down through the built shell; `null` where there is
   * no floor at all. A doorway must not leave that gap, so this is how a
   * browser check proves the floors run through the openings.
   * Read-only and ungated.
   */
  floorAt: (x: number, z: number) => string | null;
  /**
   * Furniture layout issues of the CURRENT document (`layout-lint.ts`),
   * read-only: the same list `scene-data.test.ts` asserts empty for the demo.
   * `layout-lint.ts` is sizeable and used only here, so it is loaded lazily
   * and only when the debug capability is on (a production page that never
   * asked for it does not pay for the bytes). SYNCHRONOUS on purpose
   * (`scripts/browser-check.ts` calls and filters it inline): `[]` until the
   * lazy import resolves — a handful of milliseconds after mount — real data
   * from then on. Development / `?debug=1` only.
   */
  layoutIssues?: () => LayoutIssue[];
  /**
   * Where the free-space helper would put `asset` in `roomId` (the largest
   * room when none is named) — the same answer a host editor's catalogue dialog gets
   * from `jeex-viewer/ops`. A QUERY: it changes nothing, and the caller feeds
   * the pose to `applyOps([{ op: 'place_object', … }])` itself.
   * `null` until the lazy layout module resolves. Development / `?debug=1` only.
   */
  suggestPlacement?: (asset: string, roomId?: string) => PlacementSuggestion | null;
  /**
   * How many primitives of each kind the 2D drawing of the current document
   * has (`plan-drawing.ts`): `wall`, `opening`, `leaf`, `swing`, `window`,
   * `fixture`, `room`. Read-only and UNGATED, so a browser check can prove the
   * plan modes have something to draw without `?debug=1`.
   */
  planDrawing: () => Record<string, number>;
  /**
   * The camera the last frame was drawn with: its class, where it stands, the
   * direction it looks in and its up axis. This is how a browser check proves
   * the 3D mode really installed an orthographic camera pointing straight down
   * with north up. Read-only and ungated.
   */
  renderCamera: () => {
    type: string;
    position: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  } | null;
};

/** Height the `floorAt` probe starts from, metres: above any ceiling. */
const FLOOR_PROBE_HEIGHT = 40;

declare global {
  interface Window {
    __appReady?: boolean;
    /**
     * `performance.now()` at the moment `__appReady` was set: milliseconds from
     * navigation start to a usable viewer, measured IN the page, so a readiness
     * budget is not inflated by the automation's round trips.
     */
    __viewerReadyAt?: number;
    __viewerDebug?: ViewerDebugApi;
  }
}

/**
 * What the debug contract reads, as SIX roles rather than one bag.
 *
 * The roles are not an organising flourish: they are what the contract is
 * actually about, and splitting them is what makes each one small enough to
 * read. A change to the door surface touches `DoorDebug` and nothing else, and
 * a caller assembling a host can see which subsystem it has not wired.
 *
 * Getter invariant, and the reason every member below is a FUNCTION: the stage
 * is rebuilt by Retry and the mount by every document, so anything captured
 * when the API was installed answers for the viewer that used to be there.
 * Capturing `model`, `messages`, `viewport`, `tour` or `capabilities` by value
 * at install time would be exactly that bug waiting for a Retry.
 */

/** The document and the geometry built from it. */
type SceneDebug = {
  /** The mounted model. A `loadScene` replaces it, so it is read per call. */
  model: () => SceneModel;
  /**
   * Deep copy of the committed document (`SceneModel.toJSON`) — the same read
   * `ViewerHandle.getScene()` answers. `exportScene` is an alias for it.
   */
  getScene: () => SceneData;
  sceneRoot: () => THREE.Object3D | undefined;
  builder: () => SceneBuilder | undefined;
  editor: () => ViewerEditor | undefined;
  sun: () => SunShadow | undefined;
  walkPost: () => WalkPostState | undefined;
  walkLighting: () => WalkLightingDebug | undefined;
  hdri: () => HdriDebug | undefined;
  /** The render quality tier in force (`quality-control.ts`). */
  quality: () => QualityDebug | undefined;
  renderDemand: () => DemandCounters | undefined;
  lightBake: () => LightBakeState;
  furnitureVisible: () => boolean;
  /** This instance's catalogue; `setLocale` replaces it. */
  messages: () => Messages;
};

/** Where the camera is, what it renders through, and where it can walk. */
type CameraDebug = {
  camera: () => THREE.PerspectiveCamera | undefined;
  /** What the runtime renders with; the top view swaps it (`plan-modes.ts`). */
  renderCamera: () => THREE.Camera | undefined;
  /** The box a projection is measured against; a Retry rebuilds the shell. */
  viewport: () => { clientWidth: number; clientHeight: number };
  director: () => CameraDirector | undefined;
  routeToRoom: (roomId: string) => DebugRoutePoint[] | null;
  travelPath: (roomId: string) => { length: number; points: Vec2[] } | null;
  /** The camera a PICK is cast with; the plan modes swap it (`plan-modes.pickCamera`). */
  pickCamera: () => THREE.Camera | undefined;
  /** The tour-camera overlay's group, `undefined` before the stage exists. */
  checkpointOverlay: () => THREE.Group | undefined;
  /** The mounted viewer's selection state, or `null` before the stage exists. */
  selection: () => { last: ViewerSelection | null; highlight: ViewerSelectionTarget | null } | null;
  /** The asset move tool's state, `null` before it was ever armed. */
  assetMove: () => AssetMoveDebug | null;
};

/** Door view state and the calls that drive it (`door-state.ts`). */
type DoorDebug = {
  doors: () => DoorRecord[];
  doorAutomation: () => { hold: string[]; release: string[] };
  toggleDoor: (openingId: string) => boolean;
  doorScreenPoint: (openingId: string) => { x: number; y: number } | null;
};

/** The mini-map's own state and hit points (`minimap.ts`). */
type MinimapDebug = {
  minimap: () => MinimapState;
  minimapRoomPoint: (roomId: string) => { x: number; y: number } | null;
};

/** The viewer's one `TourControls`; the debug surface exposes it without `on`. */
type TourDebug = {
  tour: () => TourControls | undefined;
};

/** The half a production page does not get. */
type AuthoringDebug = {
  /**
   * Whether the AUTHORING calls (`applyOps`, `exportScene`, `loadScene`,
   * `layoutIssues`) are installed. It is `options.debug`, decided by the host
   * that mounted the viewer — never read off `location.search`, which in an
   * embed belongs to a page that knows nothing about this component.
   */
  capabilities: () => boolean;
  loadScene: (input: unknown) => boolean;
  /**
   * The loaded bake's object bank, or `undefined` for a bare scene.
   *
   * The library, not a ready-made catalogue: `layout-lint.ts` is loaded
   * lazily, and turning the library into the bank it reads
   * (`projectLayoutCatalogue`) happens inside that module once it is there. A
   * project linted against the BUNDLED catalogue reports an empty scene,
   * because not one of its archetypes is in it.
   */
  projectLibrary: () => ProjectLibraryManifest | undefined;
  /** The mounted document's bank, which the plan drawing's fixtures are read from (`SceneMount.assetFacts`). */
  assetFacts: () => AssetFactsSource;
};

export type ViewerDebugHost = SceneDebug & CameraDebug & DoorDebug & MinimapDebug & TourDebug & AuthoringDebug;

/** Installs the debug API on `window` from the running application's subsystems, and returns it. */
export function installViewerDebug(host: ViewerDebugHost): ViewerDebugApi {
  // `model()` per call, never `const { model } = host`: `loadScene` swaps the
  // document under a surface that was installed once.
  const model = (): SceneModel => host.model();
  const controller = () => host.director()?.controller;
  const floorProbe = new THREE.Raycaster();
  const DOWN = new THREE.Vector3(0, -1, 0);

  const project = (x: number, y: number, z: number): { x: number; y: number } | null => {
    const camera = host.camera();
    if (!camera) return null;
    const { clientWidth: width, clientHeight: height } = host.viewport();
    return projectToViewport(camera, new THREE.Vector3(x, y, z), { width, height });
  };

  const api: ViewerDebugApi = {
    mode: () => controller()?.getMode(),
    camera: () => {
      const camera = host.camera();
      return camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null;
    },
    cameraLook: () => {
      const camera = host.camera();
      if (!camera) return null;
      const look = camera.getWorldDirection(new THREE.Vector3());
      return { yaw: Math.atan2(look.x, look.z), pitch: Math.asin(Math.max(-1, Math.min(1, look.y))) };
    },
    tourCameras: () => {
      const group = host.checkpointOverlay();
      if (!group) return { visible: false, rendered: false, markers: [], tube: false };
      let attached = true;
      for (let object: THREE.Object3D | null = group; object; object = object.parent) attached &&= object.visible;
      const markers = group.children.flatMap((child) => {
        const id = child.userData['checkpointId'];
        return typeof id === 'string' ? [id] : [];
      });
      const tube = group.children.some((child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.TubeGeometry);
      return {
        visible: group.visible,
        rendered: attached && group.parent !== null && controller()?.getMode() !== 'plan2d',
        markers,
        tube,
      };
    },
    children: () => host.sceneRoot()?.children.map((child) => child.name) ?? [],
    wallJoints: () => {
      const names: string[] = [];
      host.sceneRoot()?.traverse((object) => {
        if (object.userData['wallJoint'] === true) names.push(object.name);
      });
      return names;
    },
    rooms: () => model().scene.rooms.map((room) => room.id),
    furniture: () => host.furnitureVisible(),
    furnitureRendered: () => host.sceneRoot()?.getObjectByName(FURNITURE_GROUP_NAME)?.visible ?? null,
    sunShadow: () => host.sun()?.state() ?? null,
    walkPost: () => host.walkPost() ?? 'off',
    walkLighting: () => host.walkLighting() ?? { state: 'off', stats: null },
    hdri: () => host.hdri() ?? { state: 'off', preset: null, cubeSize: null, sunIntensity: null },
    quality: () => host.quality() ?? { mode: 'auto', tier: 'high' },
    renderDemand: () => host.renderDemand() ?? { ticks: 0, draws: 0, insetDraws: 0 },
    lightBake: () => host.lightBake(),
    assetModels: () => {
      const furniture = host.sceneRoot()?.getObjectByName(FURNITURE_GROUP_NAME);
      if (!furniture) return [];
      return furniture.children.map((group) => {
        const degraded = group.userData['degraded'];
        return {
          id: String(group.userData['assetId'] ?? group.name),
          state: String(group.userData['modelState'] ?? 'none'),
          ...(typeof degraded === 'string' && { degraded }),
          triangles: countTriangles(group),
        };
      });
    },
    surfaceMaterial: (name) => {
      const material = (host.sceneRoot()?.getObjectByName(name) as THREE.Mesh | undefined)?.material;
      if (!(material instanceof THREE.MeshStandardMaterial)) return null;
      const width = (material.map?.image as { width?: unknown } | undefined)?.width;
      const maps = (['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap'] as const).filter((slot) => material[slot] !== null);
      return { colour: `#${material.color.getHexString()}`, maps, mapSize: typeof width === 'number' ? width : null };
    },
    selectedFurniture: () => host.editor()?.selectedFurniture() ?? null,
    assetVariant: (id) => model().scene.assets.find((asset) => asset.id === id)?.variant ?? null,
    selectedOpening: () => host.editor()?.selectedOpening() ?? null,
    openingVariant: (id) => host.editor()?.openingVariantOf(id) ?? null,
    openings: () => host.builder()?.openingsList() ?? [],
    presets: () => host.editor()?.presets() ?? [],
    applyPreset: (presetId) => host.editor()?.applyPreset(presetId) ?? { error: 'not_ready', message: host.messages().t('error.notReady') },
    floorFinish: (roomId) => floorFinishOf(model().scene, roomId),
    wallFinish: (roomId) => roomWallFinishOf(model().scene, roomId),
    faceWall: (face) => faceFinishOf(model().scene, face),
    faces: (roomId) => host.builder()?.facesOfRoom(roomId) ?? [],
    facadeWall: () => facadeFinishOf(model().scene),
    revision: () => model().rev,
    doors: () => host.doors(),
    doorAutomation: () => host.doorAutomation(),
    toggleDoor: (openingId) => host.toggleDoor(openingId),
    doorScreenPoint: (openingId) => host.doorScreenPoint(openingId),
    minimap: () => host.minimap(),
    minimapRoomPoint: (roomId) => host.minimapRoomPoint(roomId),
    // The `door` tag travels with the waypoint: it is what names the door a
    // route crosses, and a check that had to guess one from coordinates would
    // be guessing at the apartment.
    routeToRoom: (roomId) =>
      host.routeToRoom(roomId)?.map((point) => ({ x: point.x, z: point.z, ...(point.door === undefined ? {} : { door: point.door }) })) ??
      null,
    travelPath: (roomId) => host.travelPath(roomId),
    finishTravel: () => controller()?.finishTravel() ?? false,
    navigable: (x, z) => {
      const active = controller();
      return active ? { standable: active.isNavigableAt(x, z), reachable: active.canWalkTo(x, z) } : null;
    },
    selection: () => host.selection() ?? { last: null, highlight: null },
    assetMove: () => host.assetMove() ?? { enabled: false, loaded: false, state: null },
    describeSelection: (target) => host.editor()?.describeSelection(target) ?? null,
    selectionPoint: (x, z) => {
      const camera = host.pickCamera();
      if (!camera) return null;
      const { clientWidth: width, clientHeight: height } = host.viewport();
      // Wall-mid height: the orthographic top view ignores it, and in 360 it
      // is the band a wall pick actually lands in.
      return projectToViewport(camera, new THREE.Vector3(x, 1.2, z), { width, height });
    },
    /** Solved plan geometry: click coordinates for browser-check come from here; cloned, because the committed plan is frozen and shared (`viewer-debug-plan.ts`). */
    plan: () => planDebugDto(model()),
    projectPoint: (x, y, z) => project(x, y, z),
    focusRoom: (roomId) => host.director()?.focusRoom(roomId) ?? false,
    floorPoint: (x, y) => controller()?.debugFloorPoint(x, y) ?? null,
    projectFloorPoint: (x, z) => project(x, 0, z),
    floorAt: (x, z) => {
      const root = host.sceneRoot();
      if (!root) return null;
      floorProbe.set(new THREE.Vector3(x, FLOOR_PROBE_HEIGHT, z), DOWN);
      for (const hit of floorProbe.intersectObject(root, true)) {
        if (hit.object.userData['surface'] === 'floor') return (hit.object.userData['roomId'] as string | undefined) ?? null;
      }
      return null;
    },
    planDrawing: () => planDrawingCounts(model(), host.assetFacts()),
    renderCamera: () => {
      const camera = host.renderCamera();
      if (!camera) return null;
      camera.updateMatrixWorld();
      const direction = camera.getWorldDirection(new THREE.Vector3());
      return {
        type: camera.type,
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        direction: { x: direction.x, y: direction.y, z: direction.z },
        up: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
      };
    },
  };

  // Ungated on purpose: scrubbing the tour moves the camera, it does not touch
  // the draft, so an embedding page and a browser check may drive it anywhere.
  const tour = host.tour();
  if (tour) {
    const { on: _on, ...controls } = tour;
    api.tour = controls;
  }

  if (host.capabilities()) {
    // Alias: `ViewerHandle.getScene()` is the public contract, `exportScene`
    // the pre-existing debug name `scripts/browser-check/*` still calls.
    api.exportScene = () => host.getScene();
    // `model().registries` is the same catalogue the document was validated
    // against (`SceneModel.registries`), so no extra wiring belongs on the
    // `ViewerDebugHost` for this.
    api.completeness = () => checkCompleteness(host.getScene(), model().plan, model().registries);
    api.applyOps = (ops) => model().apply({ baseRev: model().rev, ops });
    api.loadScene = (input) => host.loadScene(input);
    // Lazy AND gated (see the `layoutIssues` doc comment on `ViewerDebugApi`):
    // the module loads once, in the background, the moment the capability is
    // confirmed on — well before a browser check gets around to calling it.
    loadLayoutModules();
    // ONE resolver for both layout accessors: a bare scene lints against the
    // shipped bank, a bake against its own manifest. Two copies of this guard
    // would drift the day one of them learns to cache or validate.
    const projectCatalogue = (): LayoutCatalogue | undefined => {
      const library = host.projectLibrary();
      const lint = layoutLintModule();
      if (!library || !lint) return undefined;
      return lint.projectLayoutCatalogue(library);
    };
    api.layoutIssues = () => {
      const lint = layoutLintModule();
      if (!lint) return [];
      // Cloned like `plan()`: committed state is frozen and never handed out.
      return lint
        .lintLayout(model().scene, model().plan, projectCatalogue())
        .map((issue) => ({ ...issue, ids: [...issue.ids], at: { ...issue.at } }));
    };
    api.suggestPlacement = (asset, roomId) => {
      const freeSpace = freeSpaceModule();
      if (!freeSpace || !layoutLintModule()) return null;
      const catalogue = projectCatalogue();
      // The answer is the helper's own fresh object — no frozen state in it,
      // so nothing to clone (unlike `layoutIssues`, which copies `ids`/`at`).
      // The `...(x === undefined ? {} : { x })` spreads are what
      // `exactOptionalPropertyTypes` asks for, not a style choice.
      return freeSpace.suggestPlacement({
        scene: model().scene,
        plan: model().plan,
        asset,
        ...(roomId === undefined ? {} : { roomId }),
        ...(catalogue === undefined ? {} : { catalogue }),
      });
    };
  }

  window.__viewerDebug = api;
  return api;
}
