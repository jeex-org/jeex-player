/**
 * The operations one gesture of the asset move tool hands its host: the
 * dragged object's `move_object` and `rotate_object`, then the same for
 * everything standing on its top, bound to the room the object now stands in.
 *
 * Pure: it reads the drag's context and the placement the tool settled on.
 */

import { roomOf } from '../plan/plan-rooms.js';
import { carriedPoses, type Placed } from '../layout/asset-pose.js';
import { wrapAngle } from './drag-kit.js';
import type { DragContext, DragPose } from '../layout/asset-legality.js';
import type { AssetEdit } from './asset-edit.js';
import type { SceneOp } from '../scene/types.js';

/** The room an object binds to: its host's when it stands on a top, else the one under it. */
function roomFor(context: DragContext, placed: Placed): string | null {
  const plan = context.ctx.plan;
  const host = placed.host === null ? undefined : context.ctx.items.find((item) => item.placement.id === placed.host);
  return roomOf(plan, host ? host.placement.position : placed.pose.position);
}

/** One gesture's edit: what moved and turned, the revision it started from, and what it was (`AssetEdit.gesture`). */
export function assetEditOf(
  context: DragContext,
  gesture: { readonly assetId: string; readonly startRev: number; readonly kind: AssetEdit['gesture'] },
  placed: Placed,
  change: { readonly moved: boolean; readonly turned: boolean },
): AssetEdit {
  const pose = placed.pose;
  const ops: SceneOp[] = [];
  const room = roomFor(context, placed);
  const move = (assetId: string, at: DragPose): void => {
    ops.push({ op: 'move_object', assetId, position: { ...at.position }, ...(room === null ? {} : { room }) });
  };
  if (change.moved) move(gesture.assetId, pose);
  // A wall pose's yaw is the face's, unfolded; the payload carries it in (-PI, PI].
  if (change.turned) ops.push({ op: 'rotate_object', assetId: gesture.assetId, rotationY: wrapAngle(pose.rotationY) });
  // What stands on a host's top goes with it, bound to the host's room.
  const carried = carriedPoses(context, pose);
  for (const { placement, pose: at } of carried) {
    move(placement.id, at);
    if (change.turned) ops.push({ op: 'rotate_object', assetId: placement.id, rotationY: wrapAngle(at.rotationY) });
  }
  let verb = change.moved ? 'moved' : 'turned';
  if (change.moved && change.turned) verb = 'moved and turned';
  return {
    assetId: gesture.assetId,
    ops,
    baseRev: gesture.startRev,
    summary: `Object ${gesture.assetId} ${verb}`,
    gesture: gesture.kind,
    ...(carried.length === 0 ? {} : { carried: carried.map(({ placement }) => placement.id) }),
  };
}
