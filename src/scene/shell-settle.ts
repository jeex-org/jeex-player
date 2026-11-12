/**
 * The commit-time step after a shell edit: authored values that name a wall
 * side through the topology of the moment are re-read on the new plan.
 *
 * Two values in the document store an answer the SOLVER derives:
 *
 * - a painted face is keyed `{ room, wallId, side }`, and which room owns a
 *   wall side is the solver's answer (`plan.faces`). Dividing a room, moving
 *   an anchor or building a room against a facade wall hands the side to
 *   another owner, and the key, unchanged, would name a face that no longer
 *   exists. The paint is re-keyed to the side's new owner, in the document
 *   and in the presets; it is dropped only when its finish cannot dress the
 *   new surface (a facade-only finish on a side that became a room's wall).
 * - a door's `swing: 'in'` means «towards the wall's interior side», which is
 *   the room side on a facade wall and the left of `a -> b` between two rooms
 *   (`door-swing.interiorSideOf`). A room built on the other side of a facade
 *   wall flips that meaning with no operation touching the door; the swing is
 *   rewritten so the leaf keeps the physical side it opened to.
 *
 * Both are repairs of a key, not policy: a later document version that keys a
 * face and a swing by wall side alone makes this step unnecessary.
 *
 * Beside them, two smaller re-reads of the same kind: a zone kept by a merge
 * is attached to the walls again when a wall closes round its anchor, and a
 * bound placement moved without naming a room is bound to the room its
 * position now lies in. And one refusal: a zone's outline is stored, so an
 * edit that would leave it outside the room it lies in is refused.
 *
 * Pure module: no `three`, no DOM.
 */

import { EPS, distanceToPolygon, dot, pointInPolygon } from '../plan/plan-geometry.js';
import { anchorsPerFace, buildGraph, type PlanGraph } from '../plan/plan-graph.js';
import { interiorSideOf, pointAt } from '../plan/door-swing.js';
import { roomOf } from '../plan/plan-rooms.js';
import { solvePlan, type SolvedPlan } from '../plan/plan-solver.js';
import type { Draft } from '../shared/committed.js';
import { finishMaterialOf } from './finish-value.js';
import { TOUCHED_SHELL, touchedAsset, touchedFace, touchedOpening, type TouchedEntity } from './ops/context.js';
import { surfacesIn, type SceneRegistries } from './registries.js';
import { FaceMap, type FaceKey, type FinishRef, type Room, type SceneData, type SceneOp } from './types.js';

/** Who owns each wall side on a plan: a room id, `null` for the facade. */
function ownersOf(plan: SolvedPlan): Map<string, string | null> {
  const owners = new Map<string, string | null>();
  for (const face of plan.faces.values()) owners.set(`${face.wallId}|${face.side}`, face.roomId);
  return owners;
}

/** `face` keyed to the side's owner on the new plan, or `undefined` when the side is gone or the key already holds. */
function rekeyed(face: FaceKey, plan: SolvedPlan, owners: Map<string, string | null>): FaceKey | undefined {
  if (plan.faces.has(face)) return undefined;
  const owner = owners.get(`${face.wallId}|${face.side}`);
  if (owner === undefined) return undefined;
  return owner === null ? { wallId: face.wallId, side: face.side } : { room: owner, wallId: face.wallId, side: face.side };
}

/** Whether a finish may dress a face of that owner: a room's face is a wall, an unowned one the facade. */
function dresses(registries: SceneRegistries, finish: FinishRef | string, face: FaceKey): boolean {
  const surfaces = surfacesIn(registries, typeof finish === 'string' ? finish : finishMaterialOf(finish));
  return surfaces.has(face.room === undefined ? 'facade' : 'wall');
}

function rekeyFaceFinishes(
  draft: Draft<SceneData>,
  plan: SolvedPlan,
  owners: Map<string, string | null>,
  registries: SceneRegistries,
): TouchedEntity[] {
  const faces = draft.finishes?.faces;
  if (faces === undefined || draft.finishes === undefined) return [];
  const touched: TouchedEntity[] = [];
  const taken = new FaceMap<true>();
  for (const entry of faces) if (plan.faces.has(entry)) taken.set(entry, true);
  const kept: typeof faces = [];
  for (const entry of faces) {
    const next = rekeyed(entry, plan, owners);
    if (next === undefined) {
      kept.push(entry);
      continue;
    }
    touched.push(touchedFace({ ...(entry.room === undefined ? {} : { room: entry.room }), wallId: entry.wallId, side: entry.side }));
    // A face another entry already paints keeps that paint; an unknown key is left for the validator to name.
    if (taken.get(next) || !dresses(registries, entry.finish, next)) continue;
    taken.set(next, true);
    const { room: _old, ...rest } = entry;
    kept.push(next.room === undefined ? { ...rest } : { ...rest, room: next.room });
    touched.push(touchedFace(next));
  }
  draft.finishes.faces = kept;
  return touched;
}

/**
 * A preset `set_material` on a face, re-keyed like the document's own paint:
 * the explicit form also names its surface, which follows the owner (a room's
 * face is a `wall`, an unowned one the `facade`), and an instruction whose
 * finish cannot dress the new surface is dropped (`null`).
 */
function rekeyPresetOp(
  op: Draft<SceneOp>,
  plan: SolvedPlan,
  owners: Map<string, string | null>,
  registries: SceneRegistries,
): Draft<SceneOp> | null {
  if (op.op !== 'set_material') return op;
  const face = op.surface === undefined ? (typeof op.target === 'object' ? op.target : undefined) : op.face;
  const next = face === undefined ? undefined : rekeyed(face, plan, owners);
  if (next === undefined) return op;
  if (!dresses(registries, op.material, next)) return null;
  if (op.surface !== undefined) return { ...op, surface: next.room === undefined ? 'facade' : 'wall', face: next };
  return { ...op, target: next };
}

/**
 * The committed walls each wall of the batch descends from: itself, and the
 * wall a `split_wall` cut it from or the walls a `merge_wall` joined into it,
 * in the order the batch ran. A descendant keeps its ancestor's direction.
 */
function ancestry(ops: readonly SceneOp[]): (wallId: string) => ReadonlySet<string> {
  const from = new Map<string, Set<string>>();
  const of = (wallId: string): Set<string> => from.get(wallId) ?? new Set([wallId]);
  for (const op of ops) {
    if (op.op === 'split_wall') for (const id of op.ids) from.set(id, new Set([id, ...of(op.wallId)]));
    else if (op.op === 'merge_wall') from.set(op.id, new Set([op.id, ...op.wallIds.flatMap((id) => [...of(id)])]));
  }
  return of;
}

/**
 * Rewrites every explicit door swing whose wall's interior side turned round
 * between the two plans. A door moved onto an unrelated wall (`set_opening`
 * naming another `wallId`) is the caller's: its swing is read on the wall it
 * joined, so it is left as written. So is a swing a `set_opening` of the batch
 * wrote: it is the author's latest word, read on the plan the batch commits.
 */
function keepSwingSides(
  draft: Draft<SceneData>,
  committed: SceneData,
  before: SolvedPlan,
  after: SolvedPlan,
  ops: readonly SceneOp[],
): TouchedEntity[] {
  const touched: TouchedEntity[] = [];
  const ancestorsOf = ancestry(ops);
  const written = new Set(ops.flatMap((op) => (op.op === 'set_opening' && op.swing !== undefined ? [op.openingId] : [])));
  // Found by OPENING id: a split in the same batch carries a door onto a new wall id.
  const doorsBefore = new Map(
    committed.walls.flatMap((wall) => (wall.openings ?? []).map((opening) => [opening.id, { wall, opening }] as const)),
  );
  for (const wall of draft.walls) {
    for (const opening of wall.openings ?? []) {
      if (opening.swing === undefined || written.has(opening.id)) continue;
      const found = doorsBefore.get(opening.id);
      if (found?.opening.swing === undefined) continue;
      const { wall: old, opening: was } = found;
      if (!ancestorsOf(wall.id).has(old.id)) continue;
      const oldInterior = interiorSideOf(before, old.id, pointAt(committed, old, was.center).tangent).normal;
      const newInterior = interiorSideOf(after, wall.id, pointAt(draft, wall, opening.center).tangent).normal;
      const physical = was.swing === 'in' ? oldInterior : { x: -oldInterior.x, z: -oldInterior.z };
      const word = dot(physical, newInterior) > 0 ? 'in' : 'out';
      if (word === opening.swing) continue;
      opening.swing = word;
      touched.push(touchedOpening(opening.id));
    }
  }
  return touched;
}

/**
 * Attaches a zone to the walls again when a wall closes round its anchor: a
 * face of the new graph that no attached room claims, and exactly one zone's
 * anchor in it. That face would otherwise be refused as having no room.
 */
function reattachZones(draft: Draft<SceneData>): TouchedEntity[] {
  const zones = draft.rooms.filter((room) => room.polygon !== undefined);
  if (zones.length === 0) return [];
  let graph: PlanGraph;
  try {
    graph = buildGraph(draft.nodes, draft.walls);
  } catch {
    return [];
  }
  const attached = anchorsPerFace(graph, draft.rooms as Room[]);
  const zoned = graph.faces.map((face) => zones.filter((zone) => pointInPolygon(zone.anchor, face.polygon)));
  const touched: TouchedEntity[] = [];
  for (const [index, inFace] of zoned.entries()) {
    if (attached[index]!.length > 0 || inFace.length !== 1) continue;
    const room = draft.rooms.find((candidate) => candidate.id === inFace[0]!.id)!;
    delete room.polygon;
    touched.push(TOUCHED_SHELL);
  }
  return touched;
}

/**
 * Re-reads, on the plan the draft solves to, the painted faces (document and
 * presets) and the explicit door swings of a batch (`ops`) that edited the
 * shell or the rooms. A draft that does not solve is left alone: validation names why.
 */
export function settleShellEdit(
  draft: Draft<SceneData>,
  committed: SceneData,
  committedPlan: SolvedPlan,
  registries: SceneRegistries,
  ops: readonly SceneOp[],
): TouchedEntity[] {
  const reattached = reattachZones(draft);
  let plan: SolvedPlan;
  try {
    plan = solvePlan(draft);
  } catch {
    return reattached;
  }
  const owners = ownersOf(plan);
  const touched = [...reattached, ...rekeyFaceFinishes(draft, plan, owners, registries)];
  if (draft.interiors) {
    draft.interiors = draft.interiors.flatMap((preset) => {
      const presetOps = preset.ops.map((op) => rekeyPresetOp(op, plan, owners, registries));
      if (presetOps.every((op, index) => op === preset.ops[index])) return [preset];
      const kept = presetOps.filter((op): op is Draft<SceneOp> => op !== null);
      return kept.length === 0 ? [] : [{ ...preset, ops: kept }];
    });
  }
  touched.push(...keepSwingSides(draft, committed, committedPlan, plan, ops));
  return touched;
}

/**
 * The refusal for a shell edit that would leave a zone outside the room it
 * lies in, or `undefined`. A zone's outline (`Room.polygon`) is stored, not
 * derived, so it does not follow the walls: every vertex must stay inside or on
 * the whole face of its host room on the new plan. A zone with no host before,
 * one that found another host, and one attached to its walls are not checked.
 */
export function zoneLeavingItsRoom(candidate: SceneData, before: SolvedPlan, after: SolvedPlan): string | undefined {
  for (const zone of candidate.rooms) {
    if (zone.polygon === undefined) continue;
    const host = before.rooms.find((room) => room.roomId === zone.id)?.host;
    if (host === undefined) continue;
    const now = after.rooms.find((room) => room.roomId === zone.id)?.host;
    if (now !== undefined && now !== host) continue;
    const hostFace = after.rooms.find((room) => room.roomId === host);
    if (hostFace === undefined) continue;
    const face = hostFace.face ?? hostFace.polygon;
    const inside = zone.polygon.every((p) => pointInPolygon(p, face) || distanceToPolygon(p, face).distance <= EPS);
    if (!inside) {
      return `Zone ${zone.id} would stand outside room ${host}: move the wall back, or attach the zone with set_room { polygon: null } first`;
    }
  }
  return undefined;
}

/**
 * Binds every placement a `move_object` of the batch moved WITHOUT naming a
 * room to the room its position lies in on the committed plan, when it was
 * bound to one before. A piece standing in no room keeps its binding; an
 * unbound piece stays unbound; a room the caller named is the caller's.
 */
export function rebindMovedPlacements(draft: Draft<SceneData>, ops: readonly SceneOp[], plan: SolvedPlan): TouchedEntity[] {
  const moved = new Set<string>();
  for (const op of ops) {
    if (op.op !== 'move_object') continue;
    if (op.room === undefined) moved.add(op.assetId);
    else moved.delete(op.assetId);
  }
  const touched: TouchedEntity[] = [];
  for (const asset of draft.assets) {
    if (!moved.has(asset.id) || asset.room === undefined) continue;
    const room = roomOf(plan, asset.position);
    if (room === null || room === asset.room) continue;
    asset.room = room;
    touched.push(touchedAsset(asset.id));
  }
  return touched;
}

/** The operations after which a wall side may have changed owner. */
export const SHELL_EDITS: ReadonlySet<SceneOp['op']> = new Set<SceneOp['op']>([
  'add_node',
  'move_node',
  'remove_node',
  'add_wall',
  'set_wall',
  'remove_wall',
  'split_wall',
  'merge_wall',
  'add_room',
  'set_room',
  'remove_room',
]);
