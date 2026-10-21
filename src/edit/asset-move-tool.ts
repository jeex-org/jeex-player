/**
 * Moving furniture and other assets in the editor: the gesture state
 * machine, and the canvas listeners that feed it.
 *
 * A press on the SELECTED object (the host's `setSelection`) and a drag past
 * `DRAG_PX` moves it on its anchor surface: a floor object over the floor
 * plane, a wall object along the faces of its room and the rooms a doorway
 * joins (a vertical drag or Shift changes its height instead), a ceiling
 * object under the ceiling plane. Every pose goes through the ONE pose
 * function (`layout/asset-pose.ts` `proposePose`): snapped (a wall-snap
 * archetype's back onto a face, an `onSurface` object onto the top under it),
 * judged by the linter's own hard rules, and settled to the nearest legal
 * pose within 0.25 m when it is not legal. The object is drawn at the settled
 * pose (green), or at the pointer's in red when there is none; a release
 * commits exactly what is drawn or refuses (reverts and reports why). The
 * field of legal places (`layout/asset-mask.ts`) is drawn while it moves and
 * redrawn whenever its yaw changes. Q/E turn it `TURN_STEP_DEG`, judged like
 * a move; a host's top carries what stands on it. The edit goes to the
 * HOST to commit: the viewer never commits a move itself.
 *
 * The canvas listeners and the lazy session live in `asset-move-session.ts`.
 *
 * The host (`app/asset-move-wiring.ts`) supplies everything that lives above
 * this layer: the ray through the camera the mode draws with, the pick, the
 * document, and the sinks.
 */

import * as THREE from 'three';
import type { LayoutCatalogue } from '../layout/layout-lint.js';
import { roomOf } from '../plan/plan-rooms.js';
import { dragCatalogue, type BodyFacts } from './asset-move-catalogue.js';
import {
  dragContext,
  faceOf,
  nearestReachableFace,
  poseItem,
  wallAlong,
  type DragContext,
  type DragPose,
} from '../layout/asset-legality.js';
import { carriedPoses, proposePose, type Placed, type PoseRequest, type Proposal } from '../layout/asset-pose.js';
import { mask, type LegalityMask, type MaskSurface } from '../layout/asset-mask.js';
import { DRAG_PX, IdleCommit, sameAngle, samePosition, wrapAngle, type Scheduler } from './drag-kit.js';
import type { SolvedPlan, WallFace } from '../plan/plan-solver.js';
import type { Mirror, MirrorAxis, SceneData, SceneOp } from '../scene/types.js';
import { isMirrorAxis } from '../scene/mirror.js';
import { planMirror } from './mirror-edit.js';
import { PendingEdits } from './pending-edits.js';
import type { AssetEdit, AssetEditRefused } from './asset-edit.js';

/* ---------------------------------------------------------------- model --- */

export type { AssetEdit, AssetEditRefused } from './asset-edit.js';

/** The tool's state as `__viewerDebug.assetMove()` reports it. */
export type AssetMoveState = {
  readonly phase: 'idle' | 'pressed' | 'dragging' | 'nudging';
  readonly assetId: string | null;
  readonly surface: MaskSurface | null;
  /** The pose drawn: the settled one, else the pointer's. */
  readonly pose: DragPose | null;
  /** Whether a release would commit (a settled pose exists); `null` when nothing moves. */
  readonly legal: boolean | null;
  /** Cells of the legality field on screen. */
  readonly maskCells: number;
  /** An emitted edit the host may still refuse (`revertAssetEdit`). */
  readonly pending: string | null;
};

/** A pointer sample, in client pixels. */
export type PointerSample = { readonly clientX: number; readonly clientY: number; readonly pointerId: number; readonly shiftKey: boolean };

/** What the tool needs of the running viewer, all of it late-bound. */
export type AssetMoveHost = {
  /** Armed by the host AND the mode is `orbit` or `plan3d`. */
  active(): boolean;
  /** The furniture the host highlighted, `null` for anything else. */
  selected(): string | null;
  /** The placement under a pixel, `null` for anything that is not furniture. */
  pickAsset(clientX: number, clientY: number): string | null;
  /** The ray through a pixel and the camera the mode draws with. */
  ray(clientX: number, clientY: number): THREE.Ray | null;
  document(): { scene: SceneData; plan: SolvedPlan; rev: number } | null;
  /** What the built body knows of an object the shipped bank does not (a baked project's own library). */
  bodyFacts(assetId: string): BodyFacts | null;
  /** Puts the object's body at `pose` on screen, reflected as `mirror` when one is given (the document is unchanged). */
  show(assetId: string, pose: DragPose, mirror?: Mirror): void;
  tint(state: 'ok' | 'bad' | null): void;
  drawMask(field: LegalityMask | null): void;
  /** The author's horizontal view direction, for view-relative arrow nudges. */
  viewYaw(): number;
  onEdit(edit: AssetEdit): void;
  onRefused(refusal: AssetEditRefused): void;
  /** A drag or a key burst began (`true`) or ended. */
  onMoving(moving: boolean): void;
};

/** Arrow nudge, metres; Shift nudges `NUDGE_FAR_M`. */
export const NUDGE_M = 0.05;
export const NUDGE_FAR_M = 0.5;
/** One Q/E turn, degrees; Shift does not change it. */
export const TURN_STEP_DEG = 15;
const TURN_STEP_RAD = (TURN_STEP_DEG / 180) * Math.PI;
/**
 * A wall drag whose first movement is vertical by more than this many pixels
 * beyond its horizontal travel changes the mount height instead of sliding;
 * Shift switches to height at any time.
 */
export const WALL_VERTICAL_PX = 8;

const UP = new THREE.Vector3(0, 1, 0);
/** Q turns left (counter-clockwise from above), E right. */
const TURN_KEYS: Readonly<Record<string, number>> = { q: 1, e: -1 };

type Drag = {
  assetId: string;
  pointerId: number | null;
  drag: DragContext;
  surface: MaskSurface;
  startRev: number;
  start: DragPose;
  /** What the pointer or the keys ask for; the yaw is the person's (sticky after a wall snap turned it). */
  request: PoseRequest;
  /** The answer to `request`: what is drawn and what a release commits. */
  proposal: Proposal | null;
  /** Floor and ceiling: the grab's offset from the pivot in plan; walls: the same, at the pivot's height. */
  offset: { x: number; z: number };
  /** Wall height drag: the vertical plane, the height and the hit height at the switch. */
  vertical: { plane: THREE.Plane; startY: number; startHit: number } | null;
  /** The yaw and the room the mask was drawn for. */
  maskYaw: number | null;
  maskRoom: string | null;
  startPointer: { x: number; y: number } | null;
  /** An arrow key moved it (a key burst that is a move, not only a turn). */
  nudged: boolean;
};

/** What is drawn for a proposal: the settled placement, else the pointer's. */
function drawn(proposal: Proposal): Placed {
  return proposal.settled ?? proposal.snapped;
}

/* ------------------------------------------------------------------ tool --- */

export class AssetMoveTool {
  private readonly host: AssetMoveHost;
  private pressed: { assetId: string; sample: PointerSample; jump: boolean } | null = null;
  private moving: Drag | null = null;
  private nudging: Drag | null = null;
  private readonly pending = new PendingEdits();
  private oneShot = false;
  private maskCells = 0;
  private readonly burst: IdleCommit;
  private readonly hit = new THREE.Vector3();
  private readonly catalogue: LayoutCatalogue;

  constructor(host: AssetMoveHost, schedule?: Scheduler) {
    this.host = host;
    this.catalogue = dragCatalogue((assetId) => host.bodyFacts(assetId));
    this.burst = new IdleCommit(() => this.finishNudge(), schedule);
  }

  /** The «Move» toggle: the next press anywhere moves the selected object to it. */
  arm(): void {
    this.oneShot = true;
  }

  /** Forgets an unused «Move» toggle (the tool was switched off). */
  disarm(): void {
    this.oneShot = false;
  }

  state(): AssetMoveState {
    const drag = this.moving ?? this.nudging;
    let phase: AssetMoveState['phase'] = 'idle';
    if (this.moving) phase = 'dragging';
    else if (this.nudging) phase = 'nudging';
    else if (this.pressed) phase = 'pressed';
    const pose = drag ? this.pose(drag) : null;
    return {
      phase,
      assetId: drag?.assetId ?? this.pressed?.assetId ?? null,
      surface: drag?.surface ?? null,
      pose: pose ? { position: { ...pose.position }, rotationY: pose.rotationY } : null,
      legal: drag ? drag.proposal === null || drag.proposal.settled !== null : null,
      maskCells: this.maskCells,
      pending: this.pending.last(),
    };
  }

  // ------------------------------------------------------------- pointer --

  /** A primary press; `true` claims it. */
  down(sample: PointerSample): boolean {
    if (!this.host.active()) return false;
    const selected = this.host.selected();
    if (selected === null) return false;
    this.burst.flush();
    const jump = this.oneShot;
    if (!jump && this.host.pickAsset(sample.clientX, sample.clientY) !== selected) return false;
    this.oneShot = false;
    this.pressed = { assetId: selected, sample, jump };
    // The «Move» toggle's press moves at once: there is nothing to tell apart from a click.
    if (jump) this.begin(sample);
    return true;
  }

  /** A pointer move; `true` when it belongs to the tool. */
  move(sample: PointerSample): boolean {
    const pressed = this.pressed;
    if (!pressed || sample.pointerId !== pressed.sample.pointerId) return false;
    if (!this.host.active()) {
      this.cancel();
      return true;
    }
    if (!this.moving) {
      const travel = Math.hypot(sample.clientX - pressed.sample.clientX, sample.clientY - pressed.sample.clientY);
      if (travel < DRAG_PX) return true;
      this.begin(pressed.sample);
    }
    if (this.moving) this.follow(this.moving, sample);
    return true;
  }

  /** The release; `true` when it belongs to the tool. */
  up(sample: PointerSample): boolean {
    const pressed = this.pressed;
    if (!pressed || sample.pointerId !== pressed.sample.pointerId) return false;
    this.pressed = null;
    const drag = this.moving;
    this.moving = null;
    if (drag) this.release(drag);
    return true;
  }

  /** Escape, a cancelled pointer, a mode the tool does not serve: the running move goes back. */
  cancel(): boolean {
    const drag = this.moving ?? this.nudging;
    this.pressed = null;
    this.burst.drop();
    if (!drag) return false;
    this.moving = null;
    this.nudging = null;
    this.showAt(drag, drag.start);
    this.end();
    return true;
  }

  // ---------------------------------------------------------------- keys --

  /** One key press; `true` when the tool used it. */
  key(key: string, shiftKey: boolean): boolean {
    const name = key.toLowerCase();
    if (name === 'escape') return this.cancel();
    if (!this.host.active()) return false;
    const turn = TURN_KEYS[name] ?? 0;
    const step = shiftKey ? NUDGE_FAR_M : NUDGE_M;
    const arrows: Record<string, [number, number]> = {
      arrowup: [step, 0],
      arrowdown: [-step, 0],
      arrowleft: [0, -step],
      arrowright: [0, step],
    };
    const arrow = arrows[name];
    if (turn === 0 && !arrow) return false;
    if (this.moving) {
      if (turn !== 0) this.turnDrag(this.moving, turn);
      return true;
    }
    const drag = this.nudging ?? this.startNudge();
    if (!drag) return false;
    if (arrow) this.nudge(drag, arrow[0], arrow[1]);
    else this.turnAtRest(drag, turn);
    this.burst.touch();
    return true;
  }

  // -------------------------------------------------------- host commands --

  /**
   * `handle.turnAsset(assetId, steps)`: turns the object
   * `steps` × `TURN_STEP_DEG` (positive counter-clockwise from above, as Q),
   * judged like a move, and emits the edit or the refusal at once. `false`,
   * with no event, when the tool is not armed in a mode it serves, a drag is
   * running, the object is unknown, or it hangs on a wall (its yaw is the
   * face's).
   */
  turnAsset(assetId: string, steps: number): boolean {
    // Truncated first: `0.5` is no turn, and a turn of none must not settle an object where it stands.
    const whole = Number.isFinite(steps) ? Math.trunc(steps) : 0;
    if (!this.host.active() || this.moving || this.pressed || whole === 0) return false;
    this.burst.flush();
    const drag = this.prepare(assetId, null);
    if (!drag || drag.surface === 'wall') return false;
    const proposal = this.turned(drag, whole);
    if (!proposal) return false;
    if (!proposal.settled) {
      this.host.onRefused({ assetId, issues: proposal.judgement.issues });
      return true;
    }
    drag.proposal = proposal;
    this.commit(drag, proposal.settled);
    return true;
  }

  /** `handle.revertAssetEdit()`: the host refused the last edit; its start poses come back. */
  revert(): void {
    this.cancel();
    // Only while the document is still the one the edits were made on: after a
    // commit the rebuilt bodies already stand where the document says.
    for (const [id, start] of this.pending.take(this.host.document()?.rev) ?? []) {
      if (start.mirror) this.host.show(id, start.pose, start.mirror);
      else this.host.show(id, start.pose);
    }
  }

  /**
   * `handle.mirrorAsset`: toggles
   * one mirror axis of `assetId` and judges the result like a move — the
   * mirrored object where it stands, else the nearest legal pose within
   * `SETTLE_RADIUS_M` — then emits the edit (`mirror_object`, plus the settle
   * `move_object`) or the refusal. What stands on a mirrored host stays where
   * it is. `false`, with no event, when the tool is not armed in an
   * authoring mode, a gesture is running, the asset is unknown, or its facts
   * do not allow `axis`.
   */
  mirror(assetId: string, axis: MirrorAxis): boolean {
    if (!isMirrorAxis(axis) || !this.host.active() || this.pressed || this.moving || this.nudging) return false;
    const record = this.prepare(assetId, null);
    if (!record) return false;
    const plan = planMirror(record.drag, record.start, axis, record.request.kind === 'face' ? record.request : undefined);
    if (plan.kind === 'not-allowed') return false;
    if (plan.kind === 'refused') {
      this.host.onRefused({ assetId, issues: plan.issues });
      return true;
    }
    this.host.show(assetId, plan.pose, plan.mirror);
    this.pending.record(record.startRev, assetId, [
      { id: assetId, before: { pose: record.start, mirror: plan.before }, after: { pose: plan.pose, mirror: plan.mirror } },
    ]);
    this.host.onEdit({ assetId, ops: plan.ops, baseRev: record.startRev, summary: plan.summary, gesture: 'mirror' });
    return true;
  }

  /** A new committed document: a pending edit is answered, a running move is void. */
  documentChanged(): void {
    this.pending.clear();
    this.cancel();
  }

  dispose(): void {
    this.burst.drop();
    this.cancel();
  }

  // ------------------------------------------------------------ internals --

  /** Starts a drag of the pressed object from `sample`. */
  private begin(sample: PointerSample): void {
    const pressed = this.pressed;
    if (!pressed) return;
    const drag = this.prepare(pressed.assetId, sample.pointerId);
    if (!drag) {
      this.pressed = null;
      return;
    }
    const point = this.planHit(drag, sample);
    if (point && !pressed.jump) drag.offset = { x: point.x - drag.start.position.x, z: point.z - drag.start.position.z };
    drag.startPointer = { x: sample.clientX, y: sample.clientY };
    this.moving = drag;
    this.host.onMoving(true);
    this.redrawMask(drag);
    if (pressed.jump) this.follow(drag, sample);
    else this.host.tint('ok');
  }

  /** The drag record for `assetId`, or `null` when the document or the bank cannot answer. */
  private prepare(assetId: string, pointerId: number | null): Drag | null {
    const doc = this.host.document();
    if (!doc) return null;
    // What the screen shows: an edit the host has not answered yet is where the next one starts.
    const drag = dragContext(this.pending.sceneOf(doc.scene, doc.rev), doc.plan, assetId, this.catalogue);
    if (!drag) return null;
    const start: DragPose = { position: { ...drag.placement.position }, rotationY: drag.placement.rotationY ?? 0 };
    const surface = drag.facts.anchor;
    const face = surface === 'wall' ? faceOf(drag, start) : null;
    const request: PoseRequest = face
      ? { kind: 'face', face: face.face, t: face.t, y: start.position.y }
      : { kind: 'plan', point: { x: start.position.x, z: start.position.z }, rotationY: start.rotationY, y: start.position.y, snap: true };
    return {
      assetId,
      pointerId,
      drag,
      surface,
      startRev: doc.rev,
      start,
      request,
      proposal: null,
      offset: { x: 0, z: 0 },
      vertical: null,
      maskYaw: null,
      maskRoom: null,
      startPointer: null,
      nudged: false,
    };
  }

  /** The current pose on screen. */
  private pose(drag: Drag): DragPose {
    return drag.proposal ? drawn(drag.proposal).pose : drag.start;
  }

  /** The plan point under the pointer at the height the object moves at. */
  private planHit(drag: Drag, sample: PointerSample): { x: number; z: number } | null {
    const ray = this.host.ray(sample.clientX, sample.clientY);
    if (!ray) return null;
    const height = drag.surface === 'floor' ? 0 : poseItem(drag.drag, this.pose(drag)).y;
    const point = ray.intersectPlane(new THREE.Plane(UP, -height), this.hit);
    return point ? { x: point.x, z: point.z } : null;
  }

  /** One pointer sample applied to the drag in flight. */
  private follow(drag: Drag, sample: PointerSample): void {
    if (drag.surface === 'wall' && this.wantsHeight(drag, sample)) {
      this.followHeight(drag, sample);
      return;
    }
    drag.vertical = null;
    const point = this.planHit(drag, sample);
    if (!point) return;
    const target = { x: point.x - drag.offset.x, z: point.z - drag.offset.z };
    if (drag.request.kind === 'face') {
      const current = drag.request.face.roomId;
      const face = nearestReachableFace(drag.drag, poseItem(drag.drag, this.pose(drag)).roomId ?? current, target);
      if (!face) return;
      this.propose(drag, { kind: 'face', face: face.face, t: face.t, y: drag.request.y });
      return;
    }
    this.propose(drag, { ...drag.request, point: target, snap: true });
  }

  /** Whether a wall drag changes the height: Shift, or a first movement that was mostly vertical. */
  private wantsHeight(drag: Drag, sample: PointerSample): boolean {
    if (sample.shiftKey) return true;
    if (drag.vertical) return true;
    const start = drag.startPointer;
    if (!start || drag.request.kind !== 'face') return false;
    const dx = Math.abs(sample.clientX - start.x);
    const dy = Math.abs(sample.clientY - start.y);
    // Decided once, on the first sample past the drag threshold.
    if (!samePosition(this.pose(drag).position, drag.start.position)) return false;
    return dy - dx > WALL_VERTICAL_PX;
  }

  /** The mount height under the pointer, on a vertical plane through the object facing the viewer. */
  private followHeight(drag: Drag, sample: PointerSample): void {
    const ray = this.host.ray(sample.clientX, sample.clientY);
    const request = drag.request;
    if (!ray || request.kind !== 'face') return;
    const pose = this.pose(drag);
    if (!drag.vertical) {
      const normal = request.face.normal;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(normal.x, 0, normal.z),
        new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z),
      );
      const hit = ray.intersectPlane(plane, this.hit);
      // A view straight along the face (the plan's top view) has no height to read.
      if (!hit) return;
      drag.vertical = { plane, startY: request.y, startHit: hit.y };
      return;
    }
    const hit = ray.intersectPlane(drag.vertical.plane, this.hit);
    if (!hit) return;
    this.propose(drag, { ...request, y: this.clampHeight(drag, drag.vertical.startY + (hit.y - drag.vertical.startHit)) });
  }

  /** A wall object's centre height kept so its body stays between the floor and the ceiling. */
  private clampHeight(drag: Drag, y: number): number {
    const half = poseItem(drag.drag, this.pose(drag)).dims[1] / 2;
    return Math.min(drag.drag.ctx.scene.ceilingHeight - half, Math.max(half, y));
  }

  /** `request` through the pose function, drawn: the ghost, its tint, the field when the yaw or room changed. */
  private propose(drag: Drag, request: PoseRequest): void {
    const proposal = proposePose(drag.drag, request);
    // The yaw a wall snap gave is kept for the next sample, as the person's own (sticky snap).
    drag.request = request.kind === 'plan' ? { ...request, rotationY: proposal.snapped.pose.rotationY } : request;
    this.apply(drag, proposal);
  }

  private apply(drag: Drag, proposal: Proposal): void {
    drag.proposal = proposal;
    this.showAt(drag, drawn(proposal).pose);
    this.host.tint(proposal.settled ? 'ok' : 'bad');
    if (this.moving !== drag) return;
    const yaw = drawn(proposal).pose.rotationY;
    const room = roomOf(drag.drag.ctx.plan, drawn(proposal).pose.position);
    const yawChanged = drag.maskYaw === null || !sameAngle(yaw, drag.maskYaw);
    if (yawChanged || (drag.surface === 'wall' && room !== drag.maskRoom)) this.redrawMask(drag);
  }

  /** The dragged object (and what it carries) drawn at `pose`. */
  private showAt(drag: Drag, pose: DragPose): void {
    this.host.show(drag.assetId, pose);
    for (const carried of carriedPoses(drag.drag, pose)) this.host.show(carried.placement.id, carried.pose);
  }

  private redrawMask(drag: Drag): void {
    const item = poseItem(drag.drag, this.pose(drag));
    drag.maskYaw = item.angle;
    drag.maskRoom = item.roomId;
    const field = mask(drag.drag, item, drag.surface);
    this.maskCells = field.count;
    this.host.drawMask(field);
  }

  /** The proposal for the object turned `steps` from where it stands now, at rest; `null` for a wall object. */
  private turned(drag: Drag, steps: number): Proposal | null {
    if (drag.surface === 'wall') return null;
    const pose = this.pose(drag);
    const rotationY = wrapAngle(pose.rotationY + steps * TURN_STEP_RAD);
    // The turn is the person's yaw: no wall snap turns it back.
    return proposePose(drag.drag, {
      kind: 'plan',
      point: { x: pose.position.x, z: pose.position.z },
      rotationY,
      y: pose.position.y,
      snap: false,
    });
  }

  /** Q/E during a drag: the request's yaw turns, the pointer pose and the field follow. */
  private turnDrag(drag: Drag, steps: number): void {
    if (drag.request.kind === 'face') return;
    this.propose(drag, { ...drag.request, rotationY: wrapAngle(drag.request.rotationY + steps * TURN_STEP_RAD), snap: false });
  }

  /** Q/E at rest: turned and settled, or refused with the object as it was. */
  private turnAtRest(drag: Drag, steps: number): void {
    const proposal = this.turned(drag, steps);
    if (!proposal) return;
    if (!proposal.settled) {
      this.host.onRefused({ assetId: drag.assetId, issues: proposal.judgement.issues });
      return;
    }
    const pose = proposal.settled.pose;
    drag.request = {
      kind: 'plan',
      point: { x: pose.position.x, z: pose.position.z },
      rotationY: pose.rotationY,
      y: pose.position.y,
      snap: false,
    };
    this.apply(drag, proposal);
  }

  private nudge(drag: Drag, forward: number, right: number): void {
    drag.nudged = true;
    const request = drag.request;
    if (request.kind === 'face') {
      // Up and down lift the object; left and right slide it along its face.
      if (forward !== 0) {
        this.propose(drag, { ...request, y: this.clampHeight(drag, request.y + forward) });
        return;
      }
      // «Right» on screen is along the face when the viewer looks at it; the face's own direction decides the sign.
      const along = this.alongSign(request.face);
      // Kept where the object can stand (its width on the face), so a nudge
      // back from a corner moves at once instead of unwinding presses past it.
      this.propose(drag, { ...request, t: wallAlong(drag.drag, request.face, request.t + along * right) });
      return;
    }
    const yaw = this.host.viewYaw();
    const ahead = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const side = { x: -ahead.z, z: ahead.x };
    const point = { x: request.point.x + ahead.x * forward + side.x * right, z: request.point.z + ahead.z * forward + side.z * right };
    this.propose(drag, { ...request, point, snap: true });
  }

  /** `+1` when the face runs to the viewer's right, `-1` when to the left. */
  private alongSign(face: WallFace): number {
    const a = face.polyline[0];
    const b = face.polyline.at(-1);
    if (!a || !b) return 1;
    const yaw = this.host.viewYaw();
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    return (b.x - a.x) * right.x + (b.z - a.z) * right.z >= 0 ? 1 : -1;
  }

  private startNudge(): Drag | null {
    const selected = this.host.selected();
    if (selected === null) return null;
    const drag = this.prepare(selected, null);
    if (!drag) return null;
    this.nudging = drag;
    this.host.onMoving(true);
    return drag;
  }

  private finishNudge(): void {
    const drag = this.nudging;
    this.nudging = null;
    if (drag) this.release(drag);
  }

  /** A drag or a burst ended: commit exactly what is drawn, or refuse. */
  private release(drag: Drag): void {
    const proposal = drag.proposal;
    if (proposal && !proposal.settled) {
      this.showAt(drag, drag.start);
      this.end();
      this.host.onRefused({ assetId: drag.assetId, issues: proposal.judgement.issues });
      return;
    }
    this.end();
    if (proposal?.settled) this.commit(drag, proposal.settled);
    else this.showAt(drag, drag.start);
  }

  /** Emits `placed` as the edit, or puts the start back when nothing changed (1 mm, 0.1°). */
  private commit(drag: Drag, placed: Placed): void {
    const pose = placed.pose;
    const moved = !samePosition(pose.position, drag.start.position);
    const turned = !sameAngle(pose.rotationY, drag.start.rotationY);
    if (!moved && !turned) {
      this.showAt(drag, drag.start);
      return;
    }
    this.showAt(drag, pose);
    const carried = carriedPoses(drag.drag, pose);
    this.pending.record(drag.startRev, drag.assetId, [
      { id: drag.assetId, before: { pose: drag.start }, after: { pose } },
      ...carried.map(({ placement, pose: at }) => ({
        id: placement.id,
        before: { pose: { position: { ...placement.position }, rotationY: placement.rotationY ?? 0 } },
        after: { pose: at },
      })),
    ]);
    this.host.onEdit(this.editOf(drag, placed, moved, turned));
  }

  /** The room an object binds to: its host's when it stands on a top, else the one under it. */
  private roomFor(drag: Drag, placed: Placed): string | null {
    const plan = drag.drag.ctx.plan;
    const host = placed.host === null ? undefined : drag.drag.ctx.items.find((item) => item.placement.id === placed.host);
    return roomOf(plan, host ? host.placement.position : placed.pose.position);
  }

  private editOf(drag: Drag, placed: Placed, moved: boolean, turned: boolean): AssetEdit {
    const pose = placed.pose;
    const ops: SceneOp[] = [];
    const room = this.roomFor(drag, placed);
    const move = (assetId: string, at: DragPose): void => {
      ops.push({ op: 'move_object', assetId, position: { ...at.position }, ...(room === null ? {} : { room }) });
    };
    if (moved) move(drag.assetId, pose);
    // A wall pose's yaw is the face's, unfolded; the payload carries it in (-PI, PI].
    if (turned) ops.push({ op: 'rotate_object', assetId: drag.assetId, rotationY: wrapAngle(pose.rotationY) });
    // What stands on a host's top goes with it, bound to the host's room.
    const carried = carriedPoses(drag.drag, pose);
    for (const { placement, pose: at } of carried) {
      move(placement.id, at);
      if (turned) ops.push({ op: 'rotate_object', assetId: placement.id, rotationY: wrapAngle(at.rotationY) });
    }
    let verb = moved ? 'moved' : 'turned';
    if (moved && turned) verb = 'moved and turned';
    return {
      assetId: drag.assetId,
      ops,
      baseRev: drag.startRev,
      summary: `Object ${drag.assetId} ${verb}`,
      gesture: drag.pointerId === null && !drag.nudged ? 'turn' : 'move',
      ...(carried.length === 0 ? {} : { carried: carried.map(({ placement }) => placement.id) }),
    };
  }

  private end(): void {
    this.host.tint(null);
    this.host.drawMask(null);
    this.maskCells = 0;
    this.host.onMoving(false);
  }
}
