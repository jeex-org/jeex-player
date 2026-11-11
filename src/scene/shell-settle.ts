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
 * Pure module: no `three`, no DOM.
 */

import { dot, pointInPolygon } from '../plan/plan-geometry.js';
import { anchorsPerFace, buildGraph, type PlanGraph } from '../plan/plan-graph.js';
import { interiorSideOf, pointAt } from '../plan/door-swing.js';
import { solvePlan, type SolvedPlan } from '../plan/plan-solver.js';
import type { Draft } from '../shared/committed.js';
import { finishMaterialOf } from './finish-value.js';
import { TOUCHED_SHELL, touchedFace, touchedOpening, type TouchedEntity } from './ops/context.js';
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

/** A preset `set_material` on a face, re-keyed like the document's own paint. */
function rekeyPresetOp(op: Draft<SceneOp>, plan: SolvedPlan, owners: Map<string, string | null>): Draft<SceneOp> {
  if (op.op !== 'set_material') return op;
  if (op.surface !== undefined) {
    const next = op.face === undefined ? undefined : rekeyed(op.face, plan, owners);
    return next === undefined ? op : { ...op, face: next };
  }
  if (typeof op.target !== 'object') return op;
  const next = rekeyed(op.target, plan, owners);
  return next === undefined ? op : { ...op, target: next };
}

/** Rewrites every explicit door swing whose wall's interior side turned round between the two plans. */
function keepSwingSides(draft: Draft<SceneData>, committed: SceneData, before: SolvedPlan, after: SolvedPlan): TouchedEntity[] {
  const touched: TouchedEntity[] = [];
  for (const wall of draft.walls) {
    const old = committed.walls.find((candidate) => candidate.id === wall.id);
    if (old === undefined) continue;
    for (const opening of wall.openings ?? []) {
      if (opening.swing === undefined) continue;
      const was = (old.openings ?? []).find((candidate) => candidate.id === opening.id);
      if (was?.swing === undefined) continue;
      const oldInterior = interiorSideOf(before, old.id, pointAt(committed, old, was.center).tangent).normal;
      const newInterior = interiorSideOf(after, wall.id, pointAt(draft as SceneData, wall, opening.center).tangent).normal;
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
 * presets) and the explicit door swings of a batch that edited the shell or
 * the rooms. A draft that does not solve is left alone: validation names why.
 */
export function settleShellEdit(
  draft: Draft<SceneData>,
  committed: SceneData,
  committedPlan: SolvedPlan,
  registries: SceneRegistries,
): TouchedEntity[] {
  const reattached = reattachZones(draft);
  let plan: SolvedPlan;
  try {
    plan = solvePlan(draft as SceneData);
  } catch {
    return reattached;
  }
  const owners = ownersOf(plan);
  const touched = [...reattached, ...rekeyFaceFinishes(draft, plan, owners, registries)];
  if (draft.interiors) {
    draft.interiors = draft.interiors.map((preset) => {
      const ops = preset.ops.map((op) => rekeyPresetOp(op, plan, owners));
      return ops.every((op, index) => op === preset.ops[index]) ? preset : { ...preset, ops };
    });
  }
  touched.push(...keepSwingSides(draft, committed, committedPlan, plan));
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
