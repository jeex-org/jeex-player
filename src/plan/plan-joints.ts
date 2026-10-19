/**
 * Joint cores: the solid piece of wall body around every plan node.
 *
 * The geometry layer builds one prism per `WallFace`, extruded from the face
 * plane into the wall. That covers a wall between its mitred corners but never
 * the junction itself: at a T-junction the through-wall's face is cut in two by
 * the partition, and the wall core between the two face ends is built by
 * nobody; at a corner the two mitred prisms leave a wedge. Seen from above
 * (dollhouse) those gaps are open slots down to the floor.
 *
 * A `JointCore` closes them. It is the polygon of the wall body at one node,
 * bounded by
 * - the SAME offset lines the faces are mitred on (so it never crosses a room
 *   boundary: every core edge is either a wall face plane or a cut inside the
 *   wall body), and
 * - one cut across each incident wall, placed at the farthest of that wall's
 *   two mitred corners at this node, which is exactly where both of its face
 *   prisms have started.
 *
 * Invariants (see `plan-joints.test.ts`):
 * - the polygon is simple and positively oriented (`signedArea > 0`);
 * - no core point lies strictly inside a room: the boundary follows the room
 *   faces, never crosses them;
 * - the union of the face-prism footprints and the cores covers every wall's
 *   body rectangle — no uncovered sample anywhere in the plan.
 *
 * Pure module: no `three`, no DOM.
 */

import {
  EPS,
  add,
  arcFromChord,
  arcLength,
  arcTangent,
  cross,
  dist,
  dot,
  leftN,
  lineIntersect,
  mul,
  norm,
  signedArea,
  sub,
} from './plan-geometry.js';
import { MITER_LIMIT_FACTOR } from './plan-offset.js';
import type { PlanNode, SceneData, Vec2, Wall } from '../scene/types.js';

/** Cores below this area are a flat sliver: collinear walls of equal thickness. */
const MIN_CORE_AREA = 1e-9; // square metres

export type JointCore = {
  nodeId: string;
  /** Ids of every wall meeting at the node, in ascending exit angle. */
  wallIds: string[];
  /** Closed plan polygon of the core, positively oriented, no repeated point. */
  polygon: Vec2[];
  area: number;
};

/** One wall as seen from one of its nodes: the direction it leaves in. */
export type Arm = {
  wallId: string;
  /** Unit exit direction at the node (the arc tangent for a curved wall). */
  dir: Vec2;
  /** Half the wall thickness. */
  half: number;
  /** Centreline length of the wall; the cut is never pushed past its middle. */
  length: number;
  angle: number;
};

function armOf(wall: Wall, from: Vec2, to: Vec2, forward: boolean): Arm {
  let dir: Vec2;
  let length: number;
  if (wall.arc) {
    // The half-edge leaving this node travels `from -> to`, so its arc is the
    // wall's arc with the bulge side flipped when the travel is reversed.
    const arc = arcFromChord(from, to, wall.arc.radius, forward ? wall.arc.ccw : !wall.arc.ccw);
    dir = arcTangent(arc, arc.a0);
    length = arcLength(arc);
  } else {
    dir = norm(sub(to, from));
    length = dist(from, to);
  }
  return { wallId: wall.id, dir, half: wall.thickness / 2, length, angle: Math.atan2(dir.z, dir.x) };
}

/** Every wall leaving a node, sorted by exit angle (counter-clockwise). */
function armsByNode(scene: Pick<SceneData, 'nodes' | 'walls'>): Map<string, Arm[]> {
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const arms = new Map<string, Arm[]>();
  const push = (nodeId: string, arm: Arm): void => {
    const list = arms.get(nodeId);
    if (list) list.push(arm);
    else arms.set(nodeId, [arm]);
  };
  for (const wall of scene.walls) {
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b || dist(a.p, b.p) <= EPS) continue;
    push(wall.a, armOf(wall, a.p, b.p, true));
    push(wall.b, armOf(wall, b.p, a.p, false));
  }
  for (const list of arms.values()) list.sort((p, q) => p.angle - q.angle);
  return arms;
}

/** Point on the left (`side = 1`) or right (`side = -1`) face of `arm` at the node. */
function facePoint(node: Vec2, arm: Arm, side: 1 | -1): Vec2 {
  return add(node, mul(leftN(arm.dir), side * arm.half));
}

/**
 * Corner of the wedge counter-clockwise between `a` and `b`, i.e. between the
 * LEFT face of `a` and the RIGHT face of `b`.
 *
 * Identical rules to `plan-offset.jointAfter`, so a core corner and the mitred
 * end of the face that meets it are the same point to the last bit: a single
 * mitre vertex, two vertices for a thickness step (`jog`) or for a mitre past
 * `MITER_LIMIT_FACTOR`.
 */
function wedgeCorner(node: Vec2, a: Arm, b: Arm): Vec2[] {
  const left = facePoint(node, a, 1);
  const right = facePoint(node, b, -1);
  const hit = lineIntersect(left, a.dir, right, b.dir);
  if (hit === null) return dist(left, right) <= EPS ? [left] : [left, right];
  if (dist(hit, node) > MITER_LIMIT_FACTOR * Math.max(a.half, b.half)) return [left, right];
  return [hit];
}

/** Drops repeated and collinear vertices; keeps the polygon closed implicitly. */
function simplify(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const point of points) {
    if (out.length > 0 && dist(out.at(-1)!, point) <= EPS) continue;
    out.push(point);
  }
  while (out.length > 1 && dist(out[0]!, out.at(-1)!) <= EPS) out.pop();
  if (out.length < 3) return out;
  const kept: Vec2[] = [];
  for (let i = 0; i < out.length; i += 1) {
    const previous = out[(i - 1 + out.length) % out.length]!;
    const current = out[i]!;
    const next = out[(i + 1) % out.length]!;
    const bend = cross(sub(current, previous), sub(next, current));
    if (Math.abs(bend) > EPS * EPS) kept.push(current);
  }
  return kept.length >= 3 ? kept : [];
}

/** The core of one node, or `null` when the walls leave no gap to fill. */
function jointCoreAt(node: PlanNode, arms: Arm[]): JointCore | null {
  if (arms.length < 2) return null;
  const count = arms.length;
  const wedges = arms.map((arm, i) => wedgeCorner(node.p, arm, arms[(i + 1) % count]!));

  // How far along each wall the core reaches: the farther of its two mitred
  // corners at this node, which is where the later of its two face prisms
  // starts. Never past the middle of the wall, so two cores cannot overlap
  // beyond it — they still meet, so the coverage stays complete.
  const reach = arms.map((arm, i) => {
    const ahead = wedges[i]![0]!;
    const behind = wedges[(i - 1 + count) % count]!.at(-1)!;
    const s = Math.max(0, dot(sub(ahead, node.p), arm.dir), dot(sub(behind, node.p), arm.dir));
    return Math.min(s, arm.length / 2);
  });

  const raw: Vec2[] = [];
  arms.forEach((arm, i) => {
    const step = mul(arm.dir, reach[i]!);
    raw.push(add(facePoint(node.p, arm, -1), step), add(facePoint(node.p, arm, 1), step));
    for (const corner of wedges[i]!) raw.push(corner);
  });

  const polygon = simplify(raw);
  const area = signedArea(polygon);
  if (polygon.length < 3 || Math.abs(area) <= MIN_CORE_AREA) return null;
  // The sweep runs counter-clockwise, so the area is positive; a reversal would
  // only mean the arms met in a degenerate order, and the caller still needs a
  // positively oriented polygon to extrude.
  if (area < 0) polygon.reverse();
  return { nodeId: node.id, wallIds: arms.map((arm) => arm.wallId), polygon, area: Math.abs(area) };
}

/** One core per node that needs one, in scene node order. */
export function jointCores(scene: Pick<SceneData, 'nodes' | 'walls'>): JointCore[] {
  const arms = armsByNode(scene);
  const cores: JointCore[] = [];
  for (const node of scene.nodes) {
    const core = jointCoreAt(node, arms.get(node.id) ?? []);
    if (core) cores.push(core);
  }
  return cores;
}
