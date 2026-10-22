/**
 * The ONE pose function of a drag:
 * what a pointer point, a mask lattice point, a turn and a release become.
 *
 * `proposePose(drag, request)` takes where the object is asked to go and
 * answers three things: the SNAPPED pose (a wall-snap archetype's back pulled
 * onto a face within 0.15 m and turned to face the room; an `onSurface`
 * object risen onto the top under it), its judgement, and the SETTLED
 * pose — the snapped one when it is legal, else the nearest legal pose within
 * 0.25 m (each candidate snapped the same way), else `null`. The tool draws
 * the settled pose, tints by whether there is one, and commits exactly it; the
 * mask judges the snapped pose of every lattice point. Nothing judges a pose
 * a drag cannot produce.
 *
 * Pure module: no `three`, no DOM.
 */

import { projectOnPolyline, type PolylineHit } from '../plan/plan-geometry.js';
import { wrapAngle } from '../shared/math.js';
import { frontOf, frontYaw } from '../scene/mirror.js';
import { roomOf } from '../plan/plan-rooms.js';
import { topUnder } from './rules/surfaces.js';
import {
  boxAround,
  misfit,
  judge,
  narrowContext,
  narrowDrag,
  poseItem,
  wallPose,
  yawFacing,
  type DragContext,
  type DragPose,
  type Judgement,
} from './asset-legality.js';
import type { SolvedPlan, WallFace } from '../plan/plan-solver.js';
import type { LayoutIssue, LintItem } from './rules/context.js';
import type { DemoAsset, Vec2 } from '../scene/types.js';
import type { Bounds } from '../plan/plan-geometry.js';

/** How far a wall-snap archetype's back is pulled onto a face, metres. */
export const WALL_SNAP_M = 0.15;
/** How far a release, a turn or a nudge may be settled to a legal pose, metres. */
export const SETTLE_RADIUS_M = 0.25;
/** Lattice step of the settle search, metres. */
export const SETTLE_STEP_M = 0.025;
/** Slack around a settle's reach when it narrows the scene, metres. */
const SETTLE_PAD_M = 0.15;

/**
 * Where the object is asked to go.
 *
 * - `plan`: a floor or ceiling object at a plan point and yaw. `snap: false`
 *   skips the wall snap (a turn is the person's own yaw, not the snap's).
 *   A ceiling object keeps `y`; a floor object stands on the floor or on the
 *   top under it.
 * - `face`: a wall object `t` metres along a face, its centre `y` high.
 */
export type PoseRequest =
  | { readonly kind: 'plan'; readonly point: Vec2; readonly rotationY: number; readonly y: number; readonly snap: boolean }
  | { readonly kind: 'face'; readonly face: WallFace; readonly t: number; readonly y: number };

/** One pose a request can produce: the pose, the host it stands on, the face it hangs on. */
export type Placed = {
  readonly pose: DragPose;
  readonly host: string | null;
  readonly face: { readonly face: WallFace; readonly t: number } | null;
};

/** What `proposePose` answers. */
export type Proposal = {
  /** The request snapped: what the pointer asks for. */
  readonly snapped: Placed;
  /** The snapped pose's verdict; its issues name why a refusal refused. */
  readonly judgement: Judgement;
  /** The pose to draw and commit: `snapped` when legal, else the nearest legal one, else `null`. */
  readonly settled: Placed | null;
};

/**
 * The pose `request` produces, before any judgement (wall snap and rising
 * onto a top applied), with the object as the rules read it there: built
 * once, since a mask asks for thousands.
 */
function snapped(drag: DragContext, request: PoseRequest): { placed: Placed; item: LintItem } {
  if (request.kind === 'face') {
    const pose = wallPose(drag, request.face, request.t, request.y);
    return { placed: { pose, host: null, face: { face: request.face, t: request.t } }, item: poseItem(drag, pose) };
  }
  if (drag.facts.anchor !== 'floor') {
    const pose = { position: { x: request.point.x, y: request.y, z: request.point.z }, rotationY: request.rotationY };
    return { placed: { pose, host: null, face: null }, item: poseItem(drag, pose) };
  }
  const pose = request.snap ? wallSnapped(drag, request.point, request.rotationY) : flat(request.point, request.rotationY);
  const item = poseItem(drag, pose);
  const top = drag.facts.surfaces?.onSurface && item.quad ? topUnder(drag.ctx.items, item.quad, drag.placement.id) : null;
  if (!top) return { placed: { pose, host: null, face: null }, item };
  // Risen onto the top: only the height changes, the plan footprint is the same.
  const position = { ...pose.position, y: top.y };
  return {
    placed: { pose: { position, rotationY: pose.rotationY }, host: top.host.placement.id, face: null },
    item: { ...item, y: top.y, placement: { ...item.placement, position } },
  };
}

function flat(point: Vec2, rotationY: number): DragPose {
  return { position: { x: point.x, y: 0, z: point.z }, rotationY };
}

/** A face with its plan bounds, for the snap's cheap reject. */
type BoundedFace = { readonly face: WallFace; readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };

/** Each room's faces with their bounds, per solved plan: a mask snaps thousands of lattice points. */
const facesByRoom = new WeakMap<SolvedPlan, Map<string | null, BoundedFace[]>>();

function roomFaces(plan: SolvedPlan, roomId: string | null): readonly BoundedFace[] {
  let byRoom = facesByRoom.get(plan);
  if (!byRoom) {
    byRoom = new Map();
    for (const face of plan.faces.values()) {
      const xs = face.polyline.map((point) => point.x);
      const zs = face.polyline.map((point) => point.z);
      const bounded = { face, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
      for (const key of [face.roomId, null]) {
        const list = byRoom.get(key) ?? [];
        list.push(bounded);
        byRoom.set(key, list);
      }
    }
    facesByRoom.set(plan, byRoom);
  }
  return byRoom.get(roomId) ?? [];
}

/** The nearest face of `roomId` (any room for `null`) within `limit` metres of `point`, and the hit on it. */
function faceWithin(plan: SolvedPlan, roomId: string | null, point: Vec2, limit: number): { face: WallFace; hit: PolylineHit } | null {
  let best: { face: WallFace; hit: PolylineHit } | null = null;
  for (const bounded of roomFaces(plan, roomId)) {
    if (
      point.x < bounded.minX - limit ||
      point.x > bounded.maxX + limit ||
      point.z < bounded.minZ - limit ||
      point.z > bounded.maxZ + limit
    )
      continue;
    const hit = projectOnPolyline(bounded.face.polyline, point, bounded.face.length);
    if (!hit || hit.distance > limit || (best && best.hit.distance <= hit.distance)) continue;
    best = { face: bounded.face, hit };
  }
  return best;
}

/** A floor pose at `point`, its back pulled onto the nearest face within `WALL_SNAP_M` for a wall-snap archetype. */
function wallSnapped(drag: DragContext, point: Vec2, rotationY: number): DragPose {
  const footprint = drag.facts.footprint;
  if (!drag.facts.wallSnap || !footprint) return flat(point, rotationY);
  const plan = drag.ctx.plan;
  // The back is opposite the front, which a `z` mirror turns round.
  const mirror = drag.placement.mirror;
  const front = frontOf(rotationY + drag.facts.yaw, mirror);
  const back = { x: point.x - front.x * footprint.hz, z: point.z - front.z * footprint.hz };
  const near = faceWithin(plan, roomOf(plan, point), back, WALL_SNAP_M);
  if (!near) return flat(point, rotationY);
  const { hit } = near;
  const normal = near.face.normal;
  return {
    position: { x: hit.closest.x + normal.x * footprint.hz, y: 0, z: hit.closest.z + normal.z * footprint.hz },
    rotationY: wrapAngle(yawFacing(normal) - drag.facts.yaw - frontYaw(0, mirror)),
  };
}

/** Whether every corner of `quad` lies in `box`. */
function quadIn(quad: readonly Vec2[], box: Bounds): boolean {
  return quad.every((point) => point.x >= box.minX && point.x <= box.maxX && point.z >= box.minZ && point.z <= box.maxZ);
}

/** The bounding box of `quad`. */
function boundsOf(quad: readonly Vec2[]): Bounds {
  const xs = quad.map((point) => point.x);
  const zs = quad.map((point) => point.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/**
 * The snapped pose and only whether it is legal (`misfit`, stopping at the
 * first issue, which it names): one mask lattice point or settle candidate. On a narrowed
 * drag, a pose whose body left the narrowed box (a wall snap turned it round
 * and pulled it onto a face) is judged again against what is around IT, so
 * the narrowing never changes a verdict.
 */
export function probePose(
  drag: DragContext,
  request: PoseRequest,
): { placed: Placed; ok: boolean; item: LintItem; misfit: LayoutIssue | null } {
  const first = snapped(drag, request);
  const body = first.item.quad ?? first.item.mount?.quad ?? null;
  const narrowed = drag.narrowed;
  if (!narrowed || !body || quadIn(body, narrowed.box)) return verdictOf(drag, first);
  const near: DragContext = { ...drag, ctx: narrowContext(narrowed.whole, boundsOf(body)), narrowed: undefined };
  return verdictOf(near, snapped(near, request));
}

/** A snapped pose with whether it fits and, when it does not, the first issue it raises. */
function verdictOf(
  drag: DragContext,
  pose: { placed: Placed; item: LintItem },
): { placed: Placed; ok: boolean; item: LintItem; misfit: LayoutIssue | null } {
  const issue = misfit(drag.ctx, pose.item);
  return { ...pose, ok: issue === null, misfit: issue };
}

/** The snapped pose and every issue it raises: what a refusal names. */
export function judgePose(drag: DragContext, request: PoseRequest): { placed: Placed; judgement: Judgement; item: LintItem } {
  const { placed, item } = snapped(drag, request);
  return { placed, judgement: judge(drag.ctx, item), item };
}

/** The settle search's plan offsets, nearest first: a disc of `SETTLE_RADIUS_M` on a `SETTLE_STEP_M` lattice; built on first use. */
let settleOffsets: readonly Vec2[] | null = null;

function settleOffsetsOf(): readonly Vec2[] {
  if (settleOffsets) return settleOffsets;
  const offsets: Vec2[] = [];
  const reach = Math.round(SETTLE_RADIUS_M / SETTLE_STEP_M);
  for (let i = -reach; i <= reach; i += 1) {
    for (let j = -reach; j <= reach; j += 1) {
      const offset = { x: i * SETTLE_STEP_M, z: j * SETTLE_STEP_M };
      if (Math.hypot(offset.x, offset.z) <= SETTLE_RADIUS_M + 1e-9) offsets.push(offset);
    }
  }
  settleOffsets = offsets.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  return settleOffsets;
}

/** The request moved by a plan offset (floor, ceiling) or along its face (wall). */
function shifted(request: PoseRequest, offset: Vec2, along: number): PoseRequest {
  if (request.kind === 'face') return { ...request, t: request.t + along };
  return { ...request, point: { x: request.point.x + offset.x, z: request.point.z + offset.z } };
}

/**
 * The nearest legal pose a request moved by at most `SETTLE_RADIUS_M`
 * produces, or `null`: a floor or ceiling object on its plane, a wall object
 * along its face (a settle never takes it off the wall). Each candidate is
 * snapped like a pointer pose, so a settle near a wall lands where a drag
 * would.
 */
function settleRequest(drag: DragContext, request: PoseRequest): Placed | null {
  const centre = request.kind === 'face' ? null : request.point;
  const reach = Math.hypot(drag.facts.dims[0], drag.facts.dims[2]) * Math.abs(drag.placement.scale ?? 1) + SETTLE_RADIUS_M + SETTLE_PAD_M;
  const near = centre ? narrowDrag(drag, boxAround(centre, reach)) : drag;
  if (request.kind === 'face') {
    const steps = Math.round(SETTLE_RADIUS_M / SETTLE_STEP_M);
    for (let k = 1; k <= steps; k += 1) {
      for (const sign of [1, -1]) {
        const { placed, ok } = probePose(near, shifted(request, { x: 0, z: 0 }, sign * k * SETTLE_STEP_M));
        if (ok) return placed;
      }
    }
    return null;
  }
  for (const offset of settleOffsetsOf()) {
    if (offset.x === 0 && offset.z === 0) continue;
    const { placed, ok } = probePose(near, shifted(request, offset, 0));
    if (ok) return placed;
  }
  return null;
}

/** The request snapped, judged and settled. */
export function proposePose(drag: DragContext, request: PoseRequest): Proposal {
  const { placed, judgement } = judgePose(drag, request);
  if (judgement.ok) return { snapped: placed, judgement, settled: placed };
  return { snapped: placed, judgement, settled: settleRequest(drag, request) };
}

/**
 * Where every carried object stands when its host moves from the drag's
 * start to `pose`: rigidly, turned about the host's pivot with it.
 */
export function carriedPoses(drag: DragContext, pose: DragPose): Array<{ placement: DemoAsset; pose: DragPose }> {
  const start = drag.placement.position;
  const turn = pose.rotationY - (drag.placement.rotationY ?? 0);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return drag.carried.map(({ placement }) => {
    const dx = placement.position.x - start.x;
    const dz = placement.position.z - start.z;
    // A yaw `turn` about +Y sends (x, z) to (x cos + z sin, −x sin + z cos) (three.js rotation.y).
    const x = pose.position.x + dx * cos + dz * sin;
    const z = pose.position.z - dx * sin + dz * cos;
    const y = placement.position.y + (pose.position.y - start.y);
    return { placement, pose: { position: { x, y, z }, rotationY: wrapAngle((placement.rotationY ?? 0) + turn) } };
  });
}
