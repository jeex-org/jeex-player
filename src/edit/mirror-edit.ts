/**
 * What toggling one mirror axis of a placement does, as a pure answer the
 * move tool turns into an event: the mirrored object is judged where it
 * stands like a moved one, a near miss is settled within `SETTLE_RADIUS_M`,
 * and anything else is refused with the issues the mirrored pose raised.
 *
 * Pure module: no `three`, no DOM.
 */

import { roomOf } from '../layout/layout-lint.js';
import { judge, poseItem, type DragContext, type DragPose } from '../layout/asset-legality.js';
import { proposePose, type PoseRequest } from '../layout/asset-pose.js';
import type { LayoutIssue } from '../layout/layout-issue.js';
import { allowedMirrorAxes, mirroredAxes, mirrorOf, toggleMirror } from '../scene/mirror.js';
import type { Mirror, MirrorAxis, SceneOp } from '../scene/types.js';
import type { WallFace } from '../plan/plan-solver.js';
import { samePosition } from './drag-kit.js';

/** The answer: not allowed at all, refused with the issues, or the edit to emit. */
export type MirrorPlan =
  | { readonly kind: 'not-allowed' }
  | { readonly kind: 'refused'; readonly issues: readonly LayoutIssue[] }
  | {
      readonly kind: 'edit';
      /** The state before (for a revert) and after the toggle. */
      readonly before: Mirror;
      readonly mirror: Mirror;
      /** Where the mirrored object stands: the start pose, or the settled one. */
      readonly pose: DragPose;
      /** `mirror_object`, plus `move_object` when the pose had to settle. */
      readonly ops: readonly SceneOp[];
      readonly summary: string;
    };

/** The `move_object` that puts `assetId` at `pose`, bound to the room it stands in. */
export function moveOpAt(drag: DragContext, assetId: string, pose: DragPose): SceneOp {
  const room = roomOf(drag.ctx.plan, pose.position);
  return { op: 'move_object', assetId, position: { ...pose.position }, ...(room === null ? {} : { room }) };
}

/**
 * Plans the toggle of `axis` for the dragged placement of `drag` standing at
 * `start`; `face` is the wall it hangs on, for a wall object's settle.
 */
export function planMirror(
  drag: DragContext,
  start: DragPose,
  axis: MirrorAxis,
  face: { readonly face: WallFace; readonly t: number } | undefined,
): MirrorPlan {
  if (!allowedMirrorAxes(drag.facts.mirror).includes(axis)) return { kind: 'not-allowed' };
  const assetId = drag.placement.id;
  const before = mirrorOf(mirroredAxes(drag.placement.mirror));
  const mirror = toggleMirror(before, axis);
  const mirrored: DragContext = { ...drag, placement: { ...drag.placement, mirror } };
  let pose = start;
  const judged = judge(mirrored.ctx, poseItem(mirrored, pose));
  if (!judged.ok) {
    // Settled like any pose (asset-pose.ts), without the wall snap: a mirror is not a drag.
    const request: PoseRequest = face
      ? { kind: 'face', face: face.face, t: face.t, y: start.position.y }
      : { kind: 'plan', point: { x: start.position.x, z: start.position.z }, rotationY: start.rotationY, y: start.position.y, snap: false };
    const settled = proposePose(mirrored, request).settled;
    if (!settled) return { kind: 'refused', issues: judged.issues };
    pose = settled.pose;
  }
  const ops: SceneOp[] = [{ op: 'mirror_object', assetId, mirror }];
  const moved = !samePosition(pose.position, start.position);
  if (moved) ops.push(moveOpAt(mirrored, assetId, pose));
  const state = mirroredAxes(mirror).join(', ') || 'none';
  return { kind: 'edit', before, mirror, pose, ops, summary: `Object ${assetId} mirrored (${state})${moved ? ' and moved' : ''}` };
}
