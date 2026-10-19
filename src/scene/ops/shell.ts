/**
 * The shell operations: everything that changes the PLAN itself rather than
 * what is painted on it or placed in it.
 *
 * The plan is a GRAPH — `nodes[]` carry the coordinates and `walls[]` only
 * reference them — so this module speaks in nodes and edges: `add_node`,
 * `move_node`, `remove_node`, `add_wall`, `set_wall`, `remove_wall`,
 * `split_wall`, plus `set_ceiling`. There is deliberately no "move this wall
 * by (dx, dz)": a wall moves because its nodes moved, and a node three walls
 * share moves all three.
 *
 * They all report `TOUCHED_SHELL`, because the geometry layer has to rebuild
 * rather than repaint when the plan moves; an operation that also disturbs a
 * dependent entity (a removed wall's openings, the finishes on its faces)
 * names that entity too, so a host editor's journal can say what went with it.
 *
 * Two invariants are enforced here and nowhere else in the vocabulary:
 * every edit is proved BEFORE the draft is touched (a refusal must leave the
 * plan exactly as it was, because an applier has no undo), and a wall's
 * centreline is measured against the SAME `WALL_LIMITS` the validator will
 * measure it against at commit — a wall that applies and then loses its batch
 * is worse than one that was never applied.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Draft } from '../../shared/committed.js';
import { arcFromChord, arcLength, dist } from '../../plan/plan-geometry.js';
import { OPENING_EDGE_MARGIN, clampOpening, effectiveOpening } from '../../plan/plan-openings.js';
import { remapFaceFinishes } from '../finish-remap.js';
import type {
  AddNodeOp,
  AddWallOp,
  MoveNodeOp,
  Opening,
  RemoveNodeOp,
  RemoveWallOp,
  SceneData,
  SetCeilingOp,
  SetWallOp,
  SplitWallOp,
  TopologyRemap,
  TopologyRemapEntry,
  Vec2,
  Wall,
  WallArc,
} from '../types.js';
import { faceKey } from '../types.js';
import {
  OpError,
  TOUCHED_SHELL,
  claimedIds,
  dropFaceFinishes,
  requireFinite,
  requireNewId,
  round,
  touchedFace,
  touchedOpening,
  wallCentrelineLength,
  type OpOutcome,
  type TouchedEntity,
} from './context.js';
import { MAX_CEILING_HEIGHT, MIN_CEILING_HEIGHT, MIN_SPLIT_HALF, MIN_WALL_LENGTH, WALL_THICKNESS } from './limits.js';
import { forgetOpeningInPresets, reclampOpeningsUnder, rescaleOpeningsOnWall } from './openings.js';

/** Ceiling height, with every opening re-clamped underneath it. */
export function applySetCeiling(scene: Draft<SceneData>, op: SetCeilingOp): OpOutcome {
  if (!Number.isFinite(op.height)) throw new OpError('set_ceiling needs a finite height');
  if (op.height < MIN_CEILING_HEIGHT || op.height > MAX_CEILING_HEIGHT) {
    throw new OpError(`Ceiling height ${op.height} is outside ${MIN_CEILING_HEIGHT}..${MAX_CEILING_HEIGHT} m`);
  }
  scene.ceilingHeight = op.height;
  reclampOpeningsUnder(scene, op.height);
  return { summary: `Ceiling height set to ${round(op.height)} m`, touched: [TOUCHED_SHELL] };
}

/* -------------------------------------------------------------- nodes --- */

/** Adds a node to the centreline graph. */
export function applyAddNode(scene: Draft<SceneData>, op: AddNodeOp): OpOutcome {
  const id = requireNewId(scene, op.id, 'add_node');
  const p = finitePoint(op.p, 'add_node');
  scene.nodes.push({ id, p: { x: p.x, z: p.z } });
  return { summary: `Node ${id}: added at (${round(p.x)}, ${round(p.z)})`, touched: [TOUCHED_SHELL] };
}

/**
 * Moves a node; every wall on it follows, and every opening on those walls
 * keeps its SHARE of the wall it sits on (`center / length`) rather than its
 * metre coordinate — a door in the middle of a wall that grew stays in the
 * middle. An opening whose share no longer fits the new length is clamped back
 * onto the wall, which is the same rule `add_opening` applies.
 */
export function applyMoveNode(scene: Draft<SceneData>, op: MoveNodeOp): OpOutcome {
  if (op.p !== undefined && op.dp !== undefined) throw new OpError('move_node takes p or dp, not both');
  const node = scene.nodes.find((candidate) => candidate.id === op.nodeId);
  if (!node) throw new OpError(`Unknown node ${op.nodeId}`);
  const target = op.p ?? (op.dp === undefined ? undefined : { x: node.p.x + op.dp.x, z: node.p.z + op.dp.z });
  if (target === undefined) throw new OpError(`move_node ${op.nodeId} needs p or dp`);
  const to = finitePoint(target, 'move_node');

  // Measured before anything is written: a refusal must leave the plan exactly
  // as it was, and half a moved node is not a plan.
  const moves: { wall: Draft<Wall>; from: number; to: number }[] = [];
  for (const wall of scene.walls) {
    if (wall.a !== op.nodeId && wall.b !== op.nodeId) continue;
    const other = pointOf(scene, wall.a === op.nodeId ? wall.b : wall.a, wall.id);
    const after = centrelineLength(to, other, wall.arc, wall.id);
    if (after < MIN_WALL_LENGTH) {
      throw new OpError(
        `move_node ${op.nodeId} would leave wall ${wall.id} ${after.toFixed(3)} m long, below the minimum ${MIN_WALL_LENGTH} m`,
      );
    }
    moves.push({ wall, from: wallCentrelineLength(scene, wall), to: after });
  }

  node.p = { x: to.x, z: to.z };
  for (const move of moves) rescaleOpeningsOnWall(scene, move.wall, move.from, move.to);
  return { summary: `Node ${op.nodeId}: moved to (${round(to.x)}, ${round(to.z)})`, touched: [TOUCHED_SHELL] };
}

/** Removes a node, once nothing references it. */
export function applyRemoveNode(scene: Draft<SceneData>, op: RemoveNodeOp): OpOutcome {
  const index = scene.nodes.findIndex((candidate) => candidate.id === op.nodeId);
  if (index < 0) throw new OpError(`Unknown node ${op.nodeId}`);
  const attached = scene.walls.filter((wall) => wall.a === op.nodeId || wall.b === op.nodeId);
  if (attached.length > 0) {
    throw new OpError(`Node ${op.nodeId} still carries ${attached.map((wall) => wall.id).join(', ')}; remove those walls first`);
  }
  scene.nodes.splice(index, 1);
  return { summary: `Node ${op.nodeId}: removed`, touched: [TOUCHED_SHELL] };
}

/* -------------------------------------------------------------- walls --- */

/** Joins two existing nodes with a new wall. */
export function applyAddWall(scene: Draft<SceneData>, op: AddWallOp): OpOutcome {
  const id = requireNewId(scene, op.id, 'add_wall');
  if (op.a === op.b) throw new OpError(`add_wall needs two different nodes; both ends are ${op.a}`);
  const a = pointOf(scene, op.a, 'add_wall');
  const b = pointOf(scene, op.b, 'add_wall');
  const duplicate = scene.walls.find((wall) => (wall.a === op.a && wall.b === op.b) || (wall.a === op.b && wall.b === op.a));
  if (duplicate) throw new OpError(`Nodes ${op.a} and ${op.b} are already joined by wall ${duplicate.id}`);
  const thickness = clampThickness(op.thickness, 'add_wall');
  if (op.arc) centrelineLength(a, b, op.arc, id);

  const wall: Draft<Wall> = { id, a: op.a, b: op.b, thickness };
  if (op.role !== undefined) wall.role = op.role;
  if (op.arc !== undefined) wall.arc = { radius: op.arc.radius, ccw: op.arc.ccw };
  scene.walls.push(wall);
  return {
    summary: `Wall ${id}: added between ${op.a} and ${op.b}, thickness ${round(thickness)} m`,
    touched: [TOUCHED_SHELL],
  };
}

/**
 * Edits a wall in place. `arc: null` straightens it; an arc change moves the
 * centreline length, so the openings are re-fitted exactly as `move_node`
 * re-fits them.
 */
export function applySetWall(scene: Draft<SceneData>, op: SetWallOp): OpOutcome {
  const wall = scene.walls.find((candidate) => candidate.id === op.wallId);
  if (!wall) throw new OpError(`Unknown wall ${op.wallId}`);
  const before = wallCentrelineLength(scene, wall);
  const changes: string[] = [];

  if (op.thickness !== undefined) {
    wall.thickness = clampThickness(op.thickness, 'set_wall');
    changes.push(`thickness ${round(wall.thickness)} m`);
  }
  if (op.role !== undefined) {
    wall.role = op.role;
    changes.push(`role ${op.role}`);
  }
  if (op.arc === null) {
    delete wall.arc;
    changes.push('arc removed');
  } else if (op.arc !== undefined) {
    const a = pointOf(scene, wall.a, wall.id);
    const b = pointOf(scene, wall.b, wall.id);
    centrelineLength(a, b, op.arc, wall.id);
    wall.arc = { radius: op.arc.radius, ccw: op.arc.ccw };
    changes.push(`arc radius ${round(op.arc.radius)} m`);
  }
  if (changes.length === 0) throw new OpError(`set_wall ${op.wallId} needs at least one of thickness, role or arc`);

  const after = wallCentrelineLength(scene, wall);
  if (after !== before) rescaleOpeningsOnWall(scene, wall, before, after);
  return { summary: `Wall ${op.wallId}: ${changes.join(', ')}`, touched: [TOUCHED_SHELL] };
}

/**
 * Removes a wall with everything that only existed because of it: its
 * openings (and the presets that dressed them) and the finishes painted on its
 * two faces. Each of those lands in `touched`, so the journal can say what
 * went along.
 *
 * The entrance door is the one refusal: it is a scene-level singular the tour
 * and the UI label both read, and `remove_opening` already refuses to take it
 * silently. Move it to another wall first, exactly as that message says.
 */
export function applyRemoveWall(scene: Draft<SceneData>, op: RemoveWallOp): OpOutcome {
  const wall = scene.walls.find((candidate) => candidate.id === op.wallId);
  if (!wall) throw new OpError(`Unknown wall ${op.wallId}`);
  const openings = wall.openings ?? [];
  const entrance = openings.find((opening) => opening.entrance);
  if (entrance) {
    throw new OpError(
      `Wall ${op.wallId} carries the entrance door ${entrance.id}; ` +
        `move it with set_opening or mark another door as the entrance before removing the wall`,
    );
  }

  const touched: TouchedEntity[] = [TOUCHED_SHELL];
  for (const opening of openings) {
    touched.push(touchedOpening(opening.id));
    forgetOpeningInPresets(scene, opening.id);
  }
  scene.walls.splice(scene.walls.indexOf(wall), 1);
  // An override left behind would paint a face that no longer exists.
  for (const face of dropFaceFinishes(scene, (painted) => painted.wallId === op.wallId)) touched.push(touchedFace(face));

  const carried =
    openings.length === 0 ? '' : ` with ${openings.length === 1 ? 'opening' : 'openings'} ${openings.map((o) => o.id).join(', ')}`;
  return { summary: `Wall ${op.wallId}: removed${carried}`, touched };
}

/* ------------------------------------------------------------- splitting --- */

/**
 * The stable refusal ids of `split_wall`, carried on
 * `OpError.detail.kind` with the numbers an editor needs to react — unlike a
 * sentence, they survive a rewording.
 */
type SplitRefusal = 'split_wall_arc_unsupported' | 'split_wall_out_of_range' | 'split_wall_through_opening';

/** Refuses a split with its stable id and a structured payload for the editor. */
function refuseSplit(message: string, kind: SplitRefusal, extra: Record<string, number | string> = {}): never {
  throw new OpError(message, 'split_wall', { kind, ...extra });
}

/**
 * Cuts a straight wall into two collinear halves at a new, caller-named node.
 *
 * The node and both halves are caller-minted UUIDs, checked by the same
 * `requireNewId` every creating operation uses (`detail.reason` `invalid_id`
 * or `duplicate_id`, `detail.field` `nodeId`, `ids[0]` or `ids[1]`).
 *
 * Every check runs BEFORE the draft is touched, and each half is measured
 * against the same `MIN_SPLIT_HALF` the validator will measure it against at
 * commit — a split that applied and then lost its batch would be worse than
 * one that was never applied. Openings keep their metre coordinates: the
 * length is known exactly here, so there is no share to rescale (unlike
 * `set_wall`, which re-fits by fraction). The halves inherit `thickness` and
 * `role`; openings with `center < at` stay on `ids[0]`, the rest move to
 * `ids[1]` with `center - at`.
 *
 * The painted faces are carried by the ONE existing mechanism,
 * `remapFaceFinishes`: this operation builds the `TopologyRemap` and feeds
 * it, so both halves inherit whatever the old wall's faces wore (the split
 * policy, `finish-remap.ts`). The outcome carries the remap for a journal.
 */
export function applySplitWall(scene: Draft<SceneData>, op: SplitWallOp): OpOutcome {
  const wall = scene.walls.find((candidate) => candidate.id === op.wallId);
  if (!wall) throw new OpError(`Unknown wall ${op.wallId}`);
  if (wall.arc !== undefined) {
    refuseSplit(`Wall ${op.wallId} is curved; splitting an arc wall is not supported yet`, 'split_wall_arc_unsupported');
  }
  requireFinite(op.at, 'at', 'split_wall');
  const a = pointOf(scene, wall.a, wall.id);
  const b = pointOf(scene, wall.b, wall.id);
  const length = dist(a, b);
  if (op.at < MIN_SPLIT_HALF || op.at > length - MIN_SPLIT_HALF) {
    refuseSplit(
      `Wall ${op.wallId} is ${round(length)} m long; split at ${round(op.at)} m leaves a half under ${MIN_SPLIT_HALF} m`,
      'split_wall_out_of_range',
      { length },
    );
  }

  // All three ids are caller-minted; the set grows as they are checked, so two
  // halves may not even share an id with each other.
  const taken = claimedIds(scene);
  requireNewId(scene, op.nodeId, 'split_wall', 'nodeId', taken);
  requireNewId(scene, op.ids[0], 'split_wall', 'ids[0]', taken);
  requireNewId(scene, op.ids[1], 'split_wall', 'ids[1]', taken);

  // An opening blocks the cut not only across its own span but across the
  // OPENING_EDGE_MARGIN reveal the schema demands on the wall it ends up on:
  // a cut at the opening's very edge would leave it at t = 0 of its half and
  // lose the batch at commit. The two values reported are the edges of that
  // widened zone — the nearest cuts that clear THIS opening.
  for (const opening of wall.openings ?? []) {
    const before = opening.center - opening.width / 2 - OPENING_EDGE_MARGIN;
    const after = opening.center + opening.width / 2 + OPENING_EDGE_MARGIN;
    if (op.at > before && op.at < after) {
      refuseSplit(`Split at ${round(op.at)} m passes through opening ${opening.id} on wall ${op.wallId}`, 'split_wall_through_opening', {
        openingId: opening.id,
        before,
        after,
      });
    }
  }

  const ratio = op.at / length;
  const point = { x: a.x + (b.x - a.x) * ratio, z: a.z + (b.z - a.z) * ratio };
  const firstLength = op.at;
  const secondLength = length - op.at;

  const halves: Draft<Wall>[] = [
    { id: op.ids[0], a: wall.a, b: op.nodeId, thickness: wall.thickness },
    { id: op.ids[1], a: op.nodeId, b: wall.b, thickness: wall.thickness },
  ];
  if (wall.role !== undefined) for (const half of halves) half.role = wall.role;

  // Fresh opening objects so the discarded wall is never aliased; the clamp is
  // defence in depth only — the zone check above already proved the fit, and a
  // clamp of an in-range value is the identity, float dust on an exact
  // opening edge included.
  const openingsOf = (half: 0 | 1): Draft<Opening>[] =>
    (wall.openings ?? [])
      .filter((opening) => (half === 0 ? opening.center < op.at : opening.center >= op.at))
      .map((opening) => ({ ...opening, center: half === 0 ? opening.center : opening.center - op.at }));
  for (const [index, half] of halves.entries()) {
    const halfLength = index === 0 ? firstLength : secondLength;
    const openings = openingsOf(index as 0 | 1);
    for (const opening of openings) {
      const fitted = clampOpening(opening.type, effectiveOpening(opening, scene.ceilingHeight), {
        wallLength: halfLength,
        ceilingHeight: scene.ceilingHeight,
      });
      opening.center = fitted.center;
    }
    if (openings.length > 0) half.openings = openings;
  }

  const index = scene.walls.indexOf(wall);
  scene.nodes.push({ id: op.nodeId, p: point });
  scene.walls.splice(index, 1, ...halves);

  // The paint follows the geometry: one remap entry per painted face of the
  // old wall (owner and side preserved), both heirs inherit, `primary` is the
  // longer half. Unpainted faces have nothing to carry and get no entry.
  const finishes = scene.finishes;
  const painted = (finishes?.faces ?? []).filter((entry) => entry.wallId === op.wallId);
  const primary = firstLength >= secondLength ? op.ids[0] : op.ids[1];
  const entries: TopologyRemapEntry[] = painted.map((entry) => {
    const owner = entry.room ?? null;
    return {
      from: faceKey(owner, entry.wallId, entry.side),
      to: [faceKey(owner, op.ids[0], entry.side), faceKey(owner, op.ids[1], entry.side)],
      primary: faceKey(owner, primary, entry.side),
      status: 'split' as const,
    };
  });
  const remap: TopologyRemap = { faces: entries, created: [] };
  if (entries.length > 0 && finishes?.faces !== undefined) finishes.faces = remapFaceFinishes(finishes.faces, remap);

  return {
    summary: `Wall ${op.wallId}: split at ${round(op.at)} m into ${op.ids[0]} (${round(firstLength)} m) and ${op.ids[1]} (${round(secondLength)} m)`,
    touched: [
      TOUCHED_SHELL,
      ...entries.map((entry) => touchedFace(entry.from)),
      ...entries.flatMap((entry) => entry.to.map((face) => touchedFace(face))),
    ],
    remap,
  };
}

/* ------------------------------------------------------------ helpers --- */

/** A plan point whose two coordinates are both real numbers. */
function finitePoint(p: Vec2, owner: string): Vec2 {
  if (!p) throw new OpError(`${owner} needs a point`);
  requireFinite(p.x, 'p.x', owner);
  requireFinite(p.z, 'p.z', owner);
  return p;
}

function pointOf(scene: Draft<SceneData>, nodeId: string, context: string): Vec2 {
  const node = scene.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new OpError(`Unknown node ${nodeId} (${context})`);
  return node.p;
}

function clampThickness(value: number, op: string): number {
  requireFinite(value, 'thickness', op);
  return Math.min(Math.max(value, WALL_THICKNESS[0]), WALL_THICKNESS[1]);
}

/**
 * Centreline length of a wall given its two endpoints, refusing an arc that
 * cannot exist between them.
 *
 * `context.wallCentrelineLength` measures the wall a scene already HOLDS; this
 * one measures a wall the operation is about to propose, and is therefore the
 * place where "the chord is longer than the diameter" is caught —
 * `arcFromChord` would otherwise take the square root of a negative number and
 * hand back a silent NaN.
 */
function centrelineLength(a: Vec2, b: Vec2, arc: WallArc | undefined, wallId: string): number {
  const chord = dist(a, b);
  if (!arc) return chord;
  if (!Number.isFinite(arc.radius) || arc.radius <= 0) {
    throw new OpError(`Wall ${wallId} needs a positive arc radius, got ${arc.radius}`);
  }
  if (arc.radius < chord / 2) {
    throw new OpError(`Wall ${wallId} arc radius ${round(arc.radius)} m cannot span a chord of ${chord.toFixed(3)} m`);
  }
  return arcLength(arcFromChord(a, b, arc.radius, arc.ccw));
}
