/**
 * A plan handle's drag as operations: from the handle, the press point, the
 * current pointer point (plan metres) and the document the drag started on.
 *
 * 1. `node`: `move_node` to the node's start position plus the travel.
 * 2. `wall`: the travel across the wall (projected on the handle's normal) as
 *    one `dp` for both end nodes: the wall moves sideways and keeps its
 *    direction, and walls sharing a node follow, which is the wall graph's
 *    own meaning.
 * 3. `opening`: the body's start point plus the travel, projected onto the
 *    host wall's centreline and kept on it; `set_opening { center }`.
 * 4. `opening-end`: the dragged jamb projected the same way, the other jamb
 *    where it was; `set_opening { center, width }`. The dragged jamb stops
 *    the narrowest opening's width (`minOpeningWidth`, the limit `set_opening`
 *    clamps with) short of the fixed one, so the clamp never widens the
 *    opening around its centre and moves the jamb that was not dragged; the
 *    jambs are never reordered.
 *
 * Every value is rounded to the millimetre so a batch carries no float noise;
 * there is no other snapping, and every other limit is the validator's.
 * `changesNothing` tells a batch that leaves the start document as it was
 * (a wall dragged along itself, a handle brought back to its start), which
 * the tool does not emit.
 *
 * Pure module: no `three`, no DOM.
 */

import { add, dot, mul, projectOnPolyline, sub } from '../plan/plan-geometry.js';
import { minOpeningWidth } from '../plan/plan-openings.js';
import type { PlanHandle } from '../plan/plan-handles.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData, Vec2 } from '../scene/types.js';
import type { PlanEdit, PlanEditOp } from './plan-edit.js';

/** The ops of one drag and which handle made them; `null` when the document no longer carries the handle's target. */
export type GestureOps = { readonly gesture: PlanEdit['gesture']; readonly ops: PlanEditOp[] };

const mm = (value: number): number => Math.round(value * 1000) / 1000 + 0;
const mmPoint = (point: Vec2): Vec2 => ({ x: mm(point.x), z: mm(point.z) });

export function gestureOps(
  handle: PlanHandle,
  press: Vec2,
  pointer: Vec2,
  start: { scene: SceneData; plan: SolvedPlan },
): GestureOps | null {
  const travel = sub(pointer, press);
  switch (handle.kind) {
    case 'node':
      return { gesture: 'node', ops: [{ op: 'move_node', nodeId: handle.nodeId, p: mmPoint(add(handle.at, travel)) }] };
    case 'wall': {
      const dp = mmPoint(mul(handle.normal, dot(travel, handle.normal)));
      return { gesture: 'wall', ops: handle.nodes.map((nodeId) => ({ op: 'move_node', nodeId, dp })) };
    }
    case 'opening':
    case 'opening-end': {
      const line = start.plan.centrelines.find((candidate) => candidate.wallId === handle.wallId);
      const opening = start.scene.walls.find((wall) => wall.id === handle.wallId)?.openings?.find((item) => item.id === handle.openingId);
      const hit = line && projectOnPolyline(line.polyline, add(handle.at, travel), line.length);
      if (!line || !opening || !hit) return null;
      const t = Math.min(line.length, Math.max(0, hit.t));
      if (handle.kind === 'opening') return { gesture: 'opening', ops: [{ op: 'set_opening', openingId: opening.id, center: mm(t) }] };
      const fixed = handle.end === 'a' ? opening.center + opening.width / 2 : opening.center - opening.width / 2;
      const narrowest = minOpeningWidth(line.length);
      const [from, to] = handle.end === 'a' ? [Math.min(t, fixed - narrowest), fixed] : [fixed, Math.max(t, fixed + narrowest)];
      return {
        gesture: 'opening-width',
        ops: [{ op: 'set_opening', openingId: opening.id, center: mm((from + to) / 2), width: mm(to - from) }],
      };
    }
  }
}

/** Whether `ops` leave `scene` as it was: every node already where it is sent, every opening already at its `center` and `width`. */
export function changesNothing(ops: readonly PlanEditOp[], scene: SceneData): boolean {
  return ops.every((op) => {
    if (op.op === 'move_node') {
      if (op.dp) return op.dp.x === 0 && op.dp.z === 0;
      const node = scene.nodes.find((candidate) => candidate.id === op.nodeId);
      return node !== undefined && op.p !== undefined && node.p.x === op.p.x && node.p.z === op.p.z;
    }
    const opening = scene.walls.flatMap((wall) => wall.openings ?? []).find((candidate) => candidate.id === op.openingId);
    // The tool's `set_opening` carries only `center` and, for a jamb, `width`.
    return (
      opening !== undefined &&
      (op.center === undefined || op.center === opening.center) &&
      (op.width === undefined || op.width === opening.width)
    );
  });
}
