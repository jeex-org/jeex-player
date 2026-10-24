/**
 * The tour-camera tool: every checkpoint of the document drawn as a
 * camera you can see, grab and aim (`checkpoint-marker.ts`), the smooth
 * trajectory through them drawn as a tube, and — for the ONE active camera —
 * the height arrow and the floor yaw ring (`checkpoint-gizmo.ts`), the order
 * badges (`checkpoint-badges.ts`) and the placing ghost.
 *
 * Invariant: the COMMITTED document is the only truth. The overlay rebuilds
 * from it in `setScene`; a gesture edits a WORKING copy and reports the whole
 * new list through `onEdit` — the host commits it as one `set_tour_checkpoints`
 * op through the same batch path as every other edit, and the resulting
 * document round-trip rebuilds this overlay. A commit that fails (a 409 under
 * the host, say) therefore reverts the picture instead of leaving a phantom.
 * An edit that equals the committed list within 1 mm and 0.1° is never
 * reported (`sameList`).
 *
 * Input lives in `checkpoint-gestures.ts`, which this overlay feeds as its
 * `GestureHost`; placement rules live in `checkpoint-placement.ts`; picking is
 * screen-space (`checkpoint-picking.ts`) over the shapes projected here.
 *
 * Interaction lives in `orbit` and `plan3d`:
 * in both a press selects a camera and the body, the footprint and the yaw
 * ring drag; the height arrow and the pitch slider are `orbit`'s alone, a top
 * view shows neither truthfully. Every ray is cast through the camera the
 * mode draws with (`rayCamera`): the perspective rig in `orbit`, the plan's
 * pick camera in `plan3d`. In `walk` and `tour` the stage hides the overlay.
 *
 * The overlay never mints an id: a new camera takes the UUID its caller hands
 * to `addCheckpoint` or `startPlacing`, and a call
 * without a fresh UUID v7 creates nothing.
 */

import * as THREE from 'three';
import { trajectoryTube } from './checkpoint-trajectory.js';
import { Gizmo } from './checkpoint-gizmo.js';
import { ACCENT, CameraMarker, horizontalFov } from './checkpoint-marker.js';
import { activeShapes, badgeAt, markerShape, scaleAt, viewOf, type CheckpointView, type ViewCamera } from './checkpoint-view.js';
import { CheckpointBadges, type BadgeEntry } from './checkpoint-badges.js';
import { CheckpointGestures, type GestureHost } from './checkpoint-gestures.js';
import { nearestActiveHandle, pickHandle, sameList, type HandleKind, type Pick, type ScreenPoint } from './checkpoint-picking.js';
import {
  FALLBACK_CEILING_M,
  canStand,
  eyeHeight,
  lookAngles,
  poseFromDrop,
  poseFromEye,
  poseFromOrbit,
  standOn,
  type CheckpointPose,
  type PlacementContext,
} from './checkpoint-placement.js';
import { fieldOfViewFor } from './camera-tuning.js';
import type { Scheduler } from './checkpoint-keys.js';
import { claimedIds } from '../scene/ops/context.js';
import type { Draft } from '../shared/committed.js';
import type { Obstacle } from '../navigation/navigation.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { TourNavigation } from '../navigation/tour-legs.js';
import { isUuidV7, type SceneData, type TourCheckpoint, type ViewerMode } from '../scene/types.js';

/** A checkpoint was clicked (or the click landed off every marker: `null`). */
export type CheckpointSelect = { readonly id: string | null };
/**
 * A gesture finished and the working list is the answer. `baseRev` is the
 * revision the gesture started from, so a host can tell whether the document
 * moved underneath it, and `summary` is a one-line human reason.
 */
export type CheckpointEdit = { readonly checkpoints: readonly TourCheckpoint[]; readonly baseRev: number; readonly summary: string };

/** Where the authoring rig is drawn: hidden in `walk` and `tour`, where the visitor sees the flat. */
export const AUTHORING_MODES: ReadonlySet<ViewerMode> = new Set<ViewerMode>(['orbit', 'plan3d']);

/** The modes a press selects a camera in and a grab may start in; everywhere else the overlay is a picture. */
export const SELECT_MODES: ReadonlySet<ViewerMode> = new Set<ViewerMode>(['orbit', 'plan3d']);
/** The handles each select mode offers: a top view drags the place and the yaw, never the height or the pitch. */
const MODE_HANDLES: Readonly<Partial<Record<ViewerMode, ReadonlySet<HandleKind>>>> = {
  orbit: new Set<HandleKind>(['move', 'height', 'pitch', 'yaw']),
  plan3d: new Set<HandleKind>(['move', 'yaw']),
};
const NO_HANDLES: ReadonlySet<HandleKind> = new Set<HandleKind>();
/** The modes «Add from current view» reads a pose in: the orbit rule, or the exact eye of a walk. */
const VIEW_MODES: ReadonlySet<ViewerMode> = new Set<ViewerMode>(['orbit', 'walk']);
/** The tour's own viewport shape, for the frustum's horizontal field of view when the canvas is not measured yet. */
const FALLBACK_ASPECT = 16 / 9;

export type CheckpointOverlayDeps = {
  /** The pointer source and the projection rectangle. */
  canvas: HTMLCanvasElement;
  camera: () => THREE.PerspectiveCamera | undefined;
  /**
   * The camera this frame is DRAWN with — the top view in `plan3d`
   * (`PlanModes.activeCamera`) — which the badges and the size floor project
   * through. Absent means `camera`.
   */
  drawCamera?: (() => ViewCamera | undefined) | undefined;
  /**
   * The camera a pointer ray is cast through — `PlanModes.pickCamera()`, the
   * one object selection uses: the perspective rig in `orbit`, the plan's
   * top view in `plan3d`. Absent means `camera`.
   */
  rayCamera?: (() => ViewCamera | undefined) | undefined;
  /** The mode on screen; `undefined` before the camera stack exists. */
  mode: () => ViewerMode | undefined;
  /** The CURRENT committed scene; `null` before the first one. */
  scene: () => SceneData | null;
  /** The walkable space of the committed plan, so the tube walks through the doorways exactly as the tour does. */
  navigation?: (() => TourNavigation | null) | undefined;
  /** The committed plan, so placement and moves land on navigable floor; absent or `null` skips the floor rules. */
  plan?: (() => SolvedPlan | null) | undefined;
  /** The furniture footprints a placement steps off. */
  obstacles?: (() => readonly Obstacle[]) | undefined;
  /** The navigable floor point under a canvas pixel (`Picker.floorPoint`), or `null`. */
  floorPoint?: ((clientX: number, clientY: number) => THREE.Vector3 | null) | undefined;
  /** The viewer's key target (`ViewerRoots.root`); absent switches the keyboard nudges off. */
  keys?: HTMLElement | undefined;
  /** Where the order badges are laid; absent draws none (the unit harness). */
  container?: HTMLElement | undefined;
  /** Flies the orbit to show a camera (`handle.frameCheckpoint`); absent never frames. */
  frame?: ((checkpoint: TourCheckpoint) => void) | undefined;
  /** The committed revision, reported with every edit. */
  rev: () => number;
  /** Whether the host switched the overlay on (`handle.setCheckpointOverlay`). */
  enabled: () => boolean;
  /** Where the camera stands and looks; `null` before the stack exists. */
  pose: () => { position: THREE.Vector3; target: THREE.Vector3 } | null;
  onSelect: (selection: CheckpointSelect) => void;
  onEdit: (edit: CheckpointEdit) => void;
  /** The click-to-place state began (`true`) or ended (`false`). */
  onPlacing?: ((active: boolean) => void) | undefined;
  /** The key-burst timer; tests drive it. */
  schedule?: Scheduler | undefined;
  /**
   * Something the rig draws changed (markers, gizmo, hover, tints, the
   * placement ghost, the tube, the switch): the editing modes draw on demand,
   * so the stage answers with a redraw (`RenderDemand.invalidate`).
   */
  onChange?: (() => void) | undefined;
  /** The mounted viewer's lifetime; every listener carries it. */
  signal?: AbortSignal | undefined;
};

export class CheckpointOverlay implements GestureHost {
  readonly group = new THREE.Group();
  readonly canvas: HTMLCanvasElement;
  private readonly deps: CheckpointOverlayDeps;
  /** The committed list the working copy starts from. */
  private committed: readonly TourCheckpoint[] = [];
  /** The gesture's edit surface: the committed list as MUTABLE clones. */
  private workingList: Draft<TourCheckpoint>[] = [];
  private readonly markers = new Map<string, CameraMarker>();
  private active: string | null = null;
  private hovered: Pick | null = null;
  private invalid: string | null = null;
  /** Trajectory tube; rebuilt on every working-list change, once per frame. */
  private tube: THREE.Mesh | null = null;
  private tubeDirty = false;
  private readonly gizmo = new Gizmo();
  private readonly gestures: CheckpointGestures;
  private readonly badges: CheckpointBadges | null;
  /** The click-to-place ghost; non-null exactly while placing. */
  private ghostMarker: CameraMarker | null = null;
  /** The id the camera dropped by the running placement takes; set exactly while `ghostMarker` is. */
  private placingId: string | null = null;

  constructor(deps: CheckpointOverlayDeps) {
    this.deps = deps;
    this.canvas = deps.canvas;
    this.group.name = 'tourCheckpoints';
    this.group.visible = false;
    this.group.add(this.gizmo.group);
    this.badges = deps.container ? new CheckpointBadges(deps.container) : null;
    // Registered BEFORE the camera input and the selection controller (the
    // stage builds this overlay first), so a claimed grab can
    // `stopImmediatePropagation` them out of one pointer gesture.
    this.gestures = new CheckpointGestures(this, { keys: deps.keys, signal: deps.signal, schedule: deps.schedule });
  }

  // ------------------------------------------------------------ lifecycle --

  /** Adopts a newly committed document: the working copy resets to it. */
  setScene(scene: SceneData): void {
    this.committed = scene.tourCheckpoints ?? [];
    this.revert();
  }

  /** Applies the overlay switch; `false` drops any gesture, the placing state and the focus. */
  setEnabled(visible: boolean): void {
    if (this.group.visible !== visible) this.requestRedraw();
    this.group.visible = visible;
    if (visible) return;
    this.gestures.flushKeys();
    this.gestures.cancel();
    this.cancelPlacing();
    if (this.active !== null) this.setActive(null);
  }

  /** Applies a mode change: a gesture and the placing state cannot survive leaving the select modes. */
  setMode(mode: ViewerMode): void {
    if (SELECT_MODES.has(mode)) return;
    this.gestures.flushKeys();
    this.gestures.cancel();
    this.cancelPlacing();
  }

  dispose(): void {
    this.gestures.dispose();
    this.cancelPlacing();
    for (const marker of this.markers.values()) marker.dispose();
    this.markers.clear();
    this.disposeTube();
    this.gizmo.dispose();
    this.badges?.dispose();
    this.workingList = [];
    this.committed = [];
    this.active = null;
  }

  // ---------------------------------------------------------------- state --

  /** The active checkpoint (working pose), for the preview card. */
  activeCheckpoint(): TourCheckpoint | null {
    return this.active === null ? null : (this.working(this.active) ?? null);
  }

  /** One checkpoint's working pose, or `undefined`. */
  checkpoint(id: string): TourCheckpoint | undefined {
    return this.working(id);
  }

  /**
   * The host's own focus request (a row of the host editor's list): the same focus
   * a click on the marker gives. Refused (`false`) while the overlay is off or
   * for an unknown id; `null` always clears.
   */
  focusCheckpoint(id: string | null): boolean {
    if (id === null) {
      this.setActive(null);
      return true;
    }
    if (!this.deps.enabled() || !this.markers.has(id)) return false;
    this.setActive(id);
    return true;
  }

  /** The ONE active checkpoint; `null` clears the gizmo and the preview. */
  setActive(id: string | null): void {
    if (this.active === id) return;
    this.gestures.flushKeys();
    this.active = id;
    this.hovered = null;
    this.gizmo.hover(null);
    this.syncAll();
    this.requestRedraw();
    this.deps.onSelect({ id });
  }

  /**
   * Drops the working copy and redraws the COMMITTED list — a cancelled drag,
   * a document round-trip, or an edit the host refused to commit
   * (`handle.revertCheckpointEdit`).
   */
  revert(): void {
    this.workingList = this.committed.map((checkpoint) => ({ ...checkpoint, position: { ...checkpoint.position } }));
    this.invalid = null;
    this.rebuildMarkers();
    this.rebuildTrajectory();
    if (this.active !== null && !this.markers.has(this.active)) this.setActive(null);
    else this.syncAll();
  }

  /**
   * Hides the whole rig for the preview's inset render: the preview shows
   * what the TOUR sees, and the tour sees no cameras, no tube and no handles.
   * Answers the restore, `null` when nothing was showing.
   */
  hideForPreview(): (() => void) | null {
    if (!this.group.visible) return null;
    this.group.visible = false;
    return () => {
      this.group.visible = true;
    };
  }

  // ----------------------------------------------------------- placement --

  /**
   * «Add from current view»: a new camera `id` from the view on screen — the
   * exact eye in `walk`, the orbit rule in `orbit` (`checkpoint-placement.ts`)
   * — selected, and framed when it is off-screen. `false` for an id that is
   * not a fresh UUID v7, outside those modes, with the overlay off, or before
   * the camera stack exists.
   */
  addCheckpoint(id: string): boolean {
    if (!this.isNewCameraId(id)) return false;
    const pose = this.poseFromView();
    if (!pose) return false;
    this.insert({ id, ...pose }, 'placed from the view');
    return true;
  }

  /** «Set from current view»: replaces one camera's pose (id and name kept). */
  setCheckpointFromView(id: string): boolean {
    const target = this.working(id);
    const pose = target ? this.poseFromView() : null;
    if (!target || !pose) return false;
    this.applyPose(id, pose, `Camera ${id} set from the view`);
    return true;
  }

  /** Replaces one camera's pose and commits (look-through, preview drag, numeric host edits). */
  applyPose(id: string, pose: CheckpointPose, summary: string, baseRev = this.rev()): boolean {
    const target = this.working(id);
    if (!target) return false;
    target.position = { ...pose.position };
    target.yaw = pose.yaw;
    target.pitch = pose.pitch;
    this.changed(id);
    this.commit(summary, baseRev);
    return true;
  }

  /**
   * Enters click-to-place: a ghost follows the floor under the pointer until a
   * click drops camera `id` there. A second call while placing only renames
   * the camera to come. `false` for an id that is not a fresh UUID v7.
   */
  startPlacing(id: string): boolean {
    if (!this.editable() || !this.isNewCameraId(id)) return false;
    this.placingId = id;
    if (this.ghostMarker) return true;
    this.ghostMarker = new CameraMarker('ghost', true);
    this.ghostMarker.root.visible = false;
    this.group.add(this.ghostMarker.root);
    this.canvas.style.cursor = 'crosshair';
    this.deps.onPlacing?.(true);
    return true;
  }

  cancelPlacing(): void {
    if (!this.ghostMarker) return;
    this.ghostMarker.dispose();
    this.ghostMarker = null;
    this.placingId = null;
    this.canvas.style.cursor = '';
    this.requestRedraw();
    this.deps.onPlacing?.(false);
  }

  placing(): boolean {
    return this.ghostMarker !== null;
  }

  ghost(point: { x: number; z: number } | null, aim: { x: number; z: number } | null, valid: boolean): void {
    const ghost = this.ghostMarker;
    if (!ghost) return;
    this.requestRedraw();
    ghost.root.visible = point !== null;
    if (!point) return;
    const yaw = aim && Math.hypot(aim.x - point.x, aim.z - point.z) > 0.3 ? Math.atan2(aim.x - point.x, aim.z - point.z) : this.viewYaw();
    const ceiling = this.ceiling();
    ghost.sync({ id: 'ghost', position: { x: point.x, y: eyeHeight(ceiling), z: point.z }, yaw, pitch: 0 }, this.fov(eyeHeight(ceiling)), {
      active: true,
      hovered: false,
      invalid: !valid,
    });
  }

  drop(press: { x: number; z: number }, release: { x: number; z: number } | null): void {
    const context = this.placementContext();
    const id = this.placingId;
    this.cancelPlacing();
    if (!context || id === null || !this.isNewCameraId(id)) return;
    this.insert({ id, ...poseFromDrop(context, press, release, this.viewYaw()) }, 'placed');
  }

  // -------------------------------------------------------- GestureHost --

  editable(): boolean {
    return this.deps.enabled() && SELECT_MODES.has(this.deps.mode() ?? 'plan2d');
  }

  /** The handles the mode on screen offers; none outside the select modes. */
  handles(): ReadonlySet<HandleKind> {
    const mode = this.deps.mode();
    return (mode && MODE_HANDLES[mode]) ?? NO_HANDLES;
  }

  camera(): ViewCamera | undefined {
    return this.deps.rayCamera?.() ?? this.deps.camera();
  }

  rev(): number {
    return this.deps.rev();
  }

  ceiling(): number {
    return this.deps.scene()?.ceilingHeight ?? FALLBACK_CEILING_M;
  }

  activeId(): string | null {
    return this.active;
  }

  working(id: string): Draft<TourCheckpoint> | undefined {
    return this.workingList.find((checkpoint) => checkpoint.id === id);
  }

  changed(id: string): void {
    const checkpoint = this.working(id);
    if (!checkpoint) return;
    this.syncMarker(checkpoint);
    if (id === this.active) this.syncGizmo();
    this.tubeDirty = true;
    this.requestRedraw();
  }

  commit(summary: string, baseRev: number): void {
    if (sameList(this.workingList, this.committed)) return;
    this.deps.onEdit({ checkpoints: this.workingList.map(copyOf), baseRev, summary });
  }

  remove(id: string): void {
    const baseRev = this.rev();
    this.workingList = this.workingList.filter((checkpoint) => checkpoint.id !== id);
    this.rebuildMarkers();
    this.rebuildTrajectory();
    if (this.active === id) this.setActive(null);
    this.commit(`Camera ${id} removed`, baseRev);
  }

  pick(pointer: ScreenPoint): Pick | null {
    const view = this.view();
    if (!view) return null;
    const active = this.activeCheckpoint();
    return pickHandle(
      pointer,
      active ? { id: active.id, shapes: activeShapes(active, view, this.handles()) } : null,
      this.workingList.map((checkpoint) => markerShape(checkpoint, view)),
    );
  }

  nearestActive(pointer: ScreenPoint): number {
    const view = this.view();
    const active = this.activeCheckpoint();
    return view && active ? nearestActiveHandle(pointer, activeShapes(active, view, this.handles())) : Number.POSITIVE_INFINITY;
  }

  hover(pick: Pick | null): void {
    const before = this.hovered;
    this.hovered = pick;
    if (before?.id === pick?.id && before?.kind === pick?.kind) return;
    this.requestRedraw();
    this.gizmo.hover(pick && pick.id === this.active ? pick.kind : null);
    for (const id of [before?.id, pick?.id]) {
      const checkpoint = id === undefined ? undefined : this.working(id);
      if (checkpoint) this.syncMarker(checkpoint);
    }
  }

  canStand(point: { x: number; z: number }): boolean {
    const plan = this.deps.plan?.() ?? null;
    return plan === null || canStand(plan, point);
  }

  settle(id: string): void {
    const checkpoint = this.working(id);
    const context = this.placementContext();
    if (!checkpoint || !context) return;
    const spot = standOn(context, checkpoint.position);
    checkpoint.position = { x: spot.x, y: checkpoint.position.y, z: spot.z };
    this.changed(id);
  }

  setInvalid(id: string | null): void {
    if (this.invalid === id) return;
    const before = this.invalid;
    this.invalid = id;
    this.requestRedraw();
    for (const each of [before, id]) {
      const checkpoint = each === null ? undefined : this.working(each);
      if (checkpoint) this.syncMarker(checkpoint);
    }
  }

  floorUnder(clientX: number, clientY: number): { x: number; z: number } | null {
    const onFloor = this.deps.floorPoint?.(clientX, clientY) ?? null;
    if (onFloor) return { x: onFloor.x, z: onFloor.z };
    const camera = this.camera();
    if (!camera) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1),
      camera,
    );
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  viewYaw(): number {
    // A top view looks straight down: «forward» is the screen's up on the floor.
    const camera = this.camera();
    if (this.deps.mode() === 'plan3d' && camera) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      if (Math.hypot(up.x, up.z) > 1e-6) return Math.atan2(up.x, up.z);
    }
    const pose = this.deps.pose();
    return pose ? lookAngles(pose.position, pose.target).yaw : 0;
  }

  // -------------------------------------------------------------- frames --

  /**
   * One frame, before the render: the size floor on every body, the handles
   * at constant screen size, the badges over their cameras. Everything is
   * derived from the camera and the canvas box of THIS frame.
   */
  frame(): void {
    const view = this.shown() ? this.view() : null;
    if (!view) {
      this.badges?.hide();
      return;
    }
    const entries: BadgeEntry[] = this.workingList.map((checkpoint, index) => {
      this.markers.get(checkpoint.id)?.setScale(scaleAt(checkpoint, view).size);
      return { id: checkpoint.id, order: index + 1, at: badgeAt(checkpoint, view), active: checkpoint.id === this.active };
    });
    this.syncGizmo(view);
    this.badges?.update(entries);
  }

  /** The deferred tube rebuild, once per frame from a frame hook, before the frame's draw decision. */
  flush(): void {
    if (!this.tubeDirty) return;
    this.tubeDirty = false;
    this.rebuildTrajectory();
  }

  /** Whether the rig is on screen: switched on, and every parent visible (the stage hides it in walk and tour). */
  private shown(): boolean {
    for (let node: THREE.Object3D | null = this.group; node; node = node.parent) if (!node.visible) return false;
    return true;
  }

  // ------------------------------------------------------------- private --

  /** The pose «from the current view», or `null` when no rule applies. */
  private poseFromView(): CheckpointPose | null {
    const mode = this.deps.mode();
    const eye = this.deps.pose();
    if (!this.deps.enabled() || !mode || !VIEW_MODES.has(mode) || !eye) return null;
    if (mode === 'walk') return poseFromEye(this.ceiling(), { position: eye.position, target: eye.target });
    const context = this.placementContext();
    if (!context) return poseFromEye(this.ceiling(), { position: eye.position, target: eye.target });
    const rect = this.canvas.getBoundingClientRect();
    const centre = this.deps.floorPoint?.(rect.left + rect.width / 2, rect.top + rect.height / 2) ?? null;
    return poseFromOrbit(context, { position: eye.position, target: eye.target, centre }, this.workingList);
  }

  /**
   * True for a UUID v7 nothing claims yet: no camera of the working list and no
   * other entity of the scene — the same set `set_tour_checkpoints` refuses
   * against, so a camera the overlay accepts is one the host can commit. The
   * committed cameras are left to the working list, which may have dropped one.
   */
  private isNewCameraId(id: string): boolean {
    if (!isUuidV7(id) || this.workingList.some((checkpoint) => checkpoint.id === id)) return false;
    const scene = this.deps.scene();
    if (!scene) return true;
    const committed = (scene.tourCheckpoints ?? []).some((checkpoint) => checkpoint.id === id);
    return committed || !claimedIds(scene).has(id);
  }

  private placementContext(): PlacementContext | null {
    const plan = this.deps.plan?.() ?? null;
    const scene = this.deps.scene();
    return plan && scene ? { plan, scene, obstacles: this.deps.obstacles?.() ?? [] } : null;
  }

  /** Appends a camera, selects it, frames it when off-screen, reports the list. */
  private insert(checkpoint: TourCheckpoint, verb: string): void {
    const baseRev = this.rev();
    this.workingList = [...this.workingList, { ...checkpoint, position: { ...checkpoint.position } }];
    this.rebuildMarkers();
    this.rebuildTrajectory();
    this.setActive(checkpoint.id);
    this.commit(`Camera ${checkpoint.id} ${verb}`, baseRev);
    const view = this.view();
    const at = view?.project(checkpoint.position) ?? null;
    if (view && (!at || at.x < 0 || at.y < 0 || at.x > view.width || at.y > view.height)) this.deps.frame?.(checkpoint);
  }

  private view(): CheckpointView | null {
    return viewOf(this.deps.drawCamera?.() ?? this.deps.camera(), this.canvas);
  }

  /** The frustum's field of view at `height`: the tour's own policy (`fieldOfViewFor`), horizontal and vertical, radians. */
  private fov(height: number): { horizontal: number; vertical: number } {
    const camera = this.deps.camera();
    const aspect = camera && Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : FALLBACK_ASPECT;
    const vertical = THREE.MathUtils.degToRad(fieldOfViewFor(aspect, height));
    return { horizontal: horizontalFov(vertical, aspect), vertical };
  }

  /** Rebuilds every marker from the working list, disposing what it replaces. */
  private rebuildMarkers(): void {
    const seen = new Set<string>();
    for (const checkpoint of this.workingList) {
      seen.add(checkpoint.id);
      if (!this.markers.has(checkpoint.id)) {
        const marker = new CameraMarker(checkpoint.id);
        this.markers.set(checkpoint.id, marker);
        this.group.add(marker.root);
      }
      this.syncMarker(checkpoint);
    }
    for (const [id, marker] of this.markers) {
      if (seen.has(id)) continue;
      marker.dispose();
      this.markers.delete(id);
    }
    this.requestRedraw();
  }

  private syncMarker(checkpoint: TourCheckpoint): void {
    this.markers.get(checkpoint.id)?.sync(checkpoint, this.fov(checkpoint.position.y), {
      active: checkpoint.id === this.active,
      hovered: this.hovered?.id === checkpoint.id && this.hovered.kind === 'move',
      invalid: this.invalid === checkpoint.id,
    });
  }

  private syncAll(): void {
    for (const checkpoint of this.workingList) this.syncMarker(checkpoint);
    this.syncGizmo();
  }

  private syncGizmo(view = this.view()): void {
    const active = this.activeCheckpoint();
    if (active && view) this.gizmo.place(active, scaleAt(active, view), this.handles());
    else this.gizmo.clear();
  }

  /** The tube through the working list: the route, sampled exactly as the tour samples it. */
  private rebuildTrajectory(): void {
    this.disposeTube();
    this.tube = trajectoryTube(this.workingList, ACCENT, this.deps.navigation?.() ?? undefined);
    if (this.tube) this.group.add(this.tube);
    this.requestRedraw();
  }

  private requestRedraw(): void {
    this.deps.onChange?.();
  }

  private disposeTube(): void {
    if (!this.tube) return;
    this.group.remove(this.tube);
    this.tube.geometry.dispose();
    (this.tube.material as THREE.Material).dispose();
    this.tube = null;
  }
}

/** A plain copy of a working checkpoint — what leaves the overlay never aliases its working state. */
function copyOf(checkpoint: TourCheckpoint): TourCheckpoint {
  return { ...checkpoint, position: { ...checkpoint.position } };
}
