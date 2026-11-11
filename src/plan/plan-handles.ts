/**
 * The plan tool's handles on the 2D drawing: where they stand for the selected
 * wall or opening, in plan metres, and which one a pointer pixel lands on.
 *
 * A wall offers its two end nodes and its middle (which carries the unit
 * normal of its chord, the direction a sideways move follows); an opening
 * offers its body at `center` and its two jambs at `center ± width / 2` on its
 * wall's centreline. A room, a placement, or a target the document does not
 * carry offers none. Positions along a centreline are its true length, the
 * unit `center` is measured in.
 *
 * Pure module: no `three`, no DOM.
 */

import { add, dist, leftN, mul, norm, sub, EPS } from './plan-geometry.js';
import { planPoint, type PlanTransform } from './plan-drawing.js';
import type { SolvedPlan } from './plan-solver.js';
import type { SceneData, Vec2 } from '../scene/types.js';

/** One handle: what it moves and where it is drawn. */
export type PlanHandle =
  | { readonly kind: 'node'; readonly at: Vec2; readonly nodeId: string }
  | { readonly kind: 'wall'; readonly at: Vec2; readonly wallId: string; readonly nodes: readonly [string, string]; readonly normal: Vec2 }
  | { readonly kind: 'opening'; readonly at: Vec2; readonly openingId: string; readonly wallId: string }
  | { readonly kind: 'opening-end'; readonly at: Vec2; readonly openingId: string; readonly wallId: string; readonly end: 'a' | 'b' };

/** What a selection names, as the drawing's selection mark reads it. */
export type PlanHandleTarget = { readonly kind: 'wall' | 'opening' | 'room' | 'furniture'; readonly id: string };

/** The point `t` along a polyline whose true length is `length` (arc length for an arc wall). */
export function pointAlong(points: readonly Vec2[], length: number, t: number): Vec2 | null {
  if (points.length < 2) return null;
  let chord = 0;
  for (let i = 0; i + 1 < points.length; i += 1) chord += dist(points[i + 1]!, points[i]!);
  if (chord < EPS) return null;
  let left = Math.min(chord, Math.max(0, t * (chord / Math.max(EPS, length))));
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const segment = dist(points[i + 1]!, a);
    if (left <= segment || i + 2 === points.length)
      return add(a, mul(sub(points[i + 1]!, a), segment < EPS ? 0 : Math.min(1, left / segment)));
    left -= segment;
  }
  return null;
}

/** The handles of `target` on this plan; none for anything but a wall or an opening the document carries. */
export function planHandles(plan: SolvedPlan, scene: SceneData, target: PlanHandleTarget): PlanHandle[] {
  if (target.kind === 'wall') {
    const wall = scene.walls.find((candidate) => candidate.id === target.id);
    const line = plan.centrelines.find((candidate) => candidate.wallId === target.id);
    const a = wall && scene.nodes.find((node) => node.id === wall.a);
    const b = wall && scene.nodes.find((node) => node.id === wall.b);
    const middle = line && pointAlong(line.polyline, line.length, line.length / 2);
    if (!wall || !a || !b || !middle) return [];
    return [
      { kind: 'node', at: a.p, nodeId: a.id },
      { kind: 'node', at: b.p, nodeId: b.id },
      { kind: 'wall', at: middle, wallId: wall.id, nodes: [a.id, b.id], normal: norm(leftN(sub(b.p, a.p))) },
    ];
  }
  if (target.kind === 'opening') {
    const wall = scene.walls.find((candidate) => (candidate.openings ?? []).some((opening) => opening.id === target.id));
    const opening = wall?.openings?.find((candidate) => candidate.id === target.id);
    const line = wall && plan.centrelines.find((candidate) => candidate.wallId === wall.id);
    if (!wall || !opening || !line) return [];
    const along = (t: number): Vec2 | null => pointAlong(line.polyline, line.length, t);
    const body = along(opening.center);
    const jambA = along(opening.center - opening.width / 2);
    const jambB = along(opening.center + opening.width / 2);
    if (!body || !jambA || !jambB) return [];
    const ids = { openingId: opening.id, wallId: wall.id };
    return [
      { kind: 'opening', at: body, ...ids },
      { kind: 'opening-end', at: jambA, end: 'a', ...ids },
      { kind: 'opening-end', at: jambB, end: 'b', ...ids },
    ];
  }
  return [];
}

/** The handle nearest `pixel` (canvas pixels) within `radiusPx` of its centre, or `null`. */
export function handleAt(
  handles: readonly PlanHandle[],
  pixel: { x: number; y: number },
  transform: PlanTransform,
  radiusPx: number,
): PlanHandle | null {
  let best: PlanHandle | null = null;
  let bestGap = radiusPx;
  for (const handle of handles) {
    const centre = planPoint(transform, handle.at);
    const gap = Math.hypot(centre.x - pixel.x, centre.y - pixel.y);
    if (gap <= bestGap) {
      best = handle;
      bestGap = gap;
    }
  }
  return best;
}
