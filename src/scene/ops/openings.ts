/**
 * The opening operations: `add_opening`, `set_opening`, `remove_opening` and
 * `replace_opening_variant`.
 *
 * This module owns everything about a hole in a wall — where one is, how a
 * requested geometry is clamped onto its wall, what a removal does to the
 * interior presets that dressed it — so that `shell.ts` can re-clamp every
 * opening under a new ceiling without knowing any of it
 * (`reclampOpeningsUnder`). The dependency runs one way: shell may read
 * openings, openings never reads shell.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Draft } from '../../shared/committed.js';
import type { SceneRegistries } from '../registries.js';
import { EPS } from '../../plan/plan-geometry.js';
import {
  DEFAULT_DOOR_HEAD,
  DEFAULT_WINDOW_HEAD,
  DEFAULT_WINDOW_SILL,
  clampOpening,
  effectiveOpening,
  type OpeningGeometry,
} from '../../plan/plan-openings.js';
import { isDoorLike } from '../types.js';
import type {
  AddOpeningOp,
  Opening,
  OpeningType,
  RemoveOpeningOp,
  ReplaceOpeningVariantOp,
  SceneData,
  SetOpeningOp,
  Wall,
} from '../types.js';
import {
  OpError,
  TOUCHED_SHELL,
  forgetInPresets,
  requireNewId,
  round,
  touchedOpening,
  wallCentrelineLength,
  type OpOutcome,
} from './context.js';

export type OpeningLocation = { wall: Draft<Wall>; opening: Draft<Opening>; index: number };

/** The scene's entrance door, if it has one. The schema allows at most one. */
function entranceOpening(scene: Draft<SceneData>): OpeningLocation | null {
  for (const wall of scene.walls) {
    const openings = wall.openings ?? [];
    const index = openings.findIndex((candidate) => candidate.entrance === true);
    if (index >= 0) return { wall, opening: openings[index]!, index };
  }
  return null;
}

export function findOpening(scene: Draft<SceneData>, openingId: string): OpeningLocation | null {
  for (const wall of scene.walls) {
    const openings = wall.openings ?? [];
    const index = openings.findIndex((candidate) => candidate.id === openingId);
    if (index >= 0) return { wall, opening: openings[index]!, index };
  }
  return null;
}

/** Tolerance for "this value is still the default", metres. */
const SAME_M = 1e-9;

/**
 * Writes a clamped geometry back onto an opening, preserving omissions.
 *
 * An authored `sill`/`head` that was omitted means "the default for this kind"
 * (`plan-openings.effectiveOpening`). Materialising it on every edit would let
 * a width change silently move a head nobody asked about, so a field is only
 * written when it was already there or when clamping actually moved it.
 */
function writeGeometry(opening: Draft<Opening>, geometry: OpeningGeometry, ceilingHeight: number): void {
  opening.center = geometry.center;
  opening.width = geometry.width;
  const defaults = effectiveOpening({ ...opening, sill: undefined, head: undefined }, ceilingHeight);
  if (opening.head !== undefined || Math.abs(geometry.head - defaults.head) > SAME_M) {
    opening.head = geometry.head;
  }
  if (isDoorLike(opening.type)) {
    delete opening.sill;
    return;
  }
  if (opening.sill !== undefined || Math.abs(geometry.sill - defaults.sill) > SAME_M) {
    opening.sill = geometry.sill;
  }
}

/**
 * Re-fits one wall's openings after its centreline length changed, keeping
 * each opening's SHARE of the wall (`center / length`).
 *
 * The share, not the metre coordinate: a door in the middle of a wall that was
 * stretched stays in the middle, which is what an editor dragging a node
 * expects to see. The share is only a request — `clampOpening` still has the
 * last word, so an opening whose share no longer leaves room for its own width
 * slides back onto the wall instead of hanging off its end.
 *
 * It lives here rather than in `shell.ts` for the same reason
 * `reclampOpeningsUnder` does: `shell.ts` may read openings, openings never
 * reads shell.
 */
export function rescaleOpeningsOnWall(scene: Draft<SceneData>, wall: Draft<Wall>, from: number, to: number): void {
  if (!wall.openings || wall.openings.length === 0) return;
  // A zero-length source has no share to preserve; every opening is simply
  // re-clamped onto the new wall.
  const scale = from > 0 ? to / from : 1;
  for (const opening of wall.openings) {
    const current = effectiveOpening(opening, scene.ceilingHeight);
    const requested = { ...current, center: current.center * scale };
    const bounds = { wallLength: to, ceilingHeight: scene.ceilingHeight };
    writeGeometry(opening, clampOpening(opening.type, requested, bounds), scene.ceilingHeight);
  }
}

/**
 * Re-clamps every opening of the scene under a new ceiling height.
 *
 * `set_ceiling` is a SHELL operation whose side effect is entirely about
 * openings (a head above the new ceiling has to come down), so the loop lives
 * here with the rest of the opening geometry and `shell.ts` asks for it.
 */
export function reclampOpeningsUnder(scene: Draft<SceneData>, ceilingHeight: number): void {
  for (const wall of scene.walls) {
    if (!wall.openings || wall.openings.length === 0) continue;
    const wallLength = wallCentrelineLength(scene, wall);
    for (const opening of wall.openings) {
      const bounds = { wallLength, ceilingHeight };
      writeGeometry(opening, clampOpening(opening.type, effectiveOpening(opening, ceilingHeight), bounds), ceilingHeight);
    }
  }
}

/**
 * The fit check `add_opening` runs, in one place so that a move can run it too.
 *
 * Two questions, and they are one decision: does the requested geometry fit the
 * WALL (the clamp answers by correcting it), and does it fit BESIDE what the
 * wall already carries (nothing can correct that, so it is a refusal). The
 * second half is answered here, not left to `validateScene`'s
 * `openings-overlap`, which would let a batch apply and then die a layer away
 * from the operation that caused it, with a message about a document rather
 * than about the move the editor just made.
 *
 * Touching ends are not an overlap: an opening may start exactly where its
 * neighbour ends, which is the same `EPS` slack `validate/walls.ts` allows.
 * `self` is the opening being edited, excluded from its own comparison.
 */
export function fitOntoWall(
  scene: Draft<SceneData>,
  wall: Draft<Wall>,
  type: OpeningType,
  requested: OpeningGeometry,
  self?: string,
): OpeningGeometry {
  const wallLength = wallCentrelineLength(scene, wall);
  const fitted = clampOpening(type, requested, { wallLength, ceilingHeight: scene.ceilingHeight });
  const from = fitted.center - fitted.width / 2;
  const to = fitted.center + fitted.width / 2;
  for (const neighbour of wall.openings ?? []) {
    if (neighbour.id === self) continue;
    const start = neighbour.center - neighbour.width / 2;
    const end = neighbour.center + neighbour.width / 2;
    if (from < end - EPS && start < to - EPS) {
      throw new OpError(`Opening would overlap ${neighbour.id} on wall ${wall.id}`);
    }
  }
  return fitted;
}

export function applyReplaceOpeningVariant(scene: Draft<SceneData>, op: ReplaceOpeningVariantOp, registries: SceneRegistries): OpOutcome {
  const found = findOpening(scene, op.openingId);
  if (!found) throw new OpError(`Unknown opening ${op.openingId}`);
  const variant = registries.findOpeningVariant(op.variant);
  if (!variant) throw new OpError(`Unknown opening variant ${op.variant}`);
  if (variant.for !== registries.variantFamily(found.opening.type)) {
    throw new OpError(`Variant ${op.variant} is built for a ${variant.for}, not a ${found.opening.type}`);
  }
  found.opening.variant = op.variant;
  return {
    summary: `Opening ${op.openingId} replaced with variant ${op.variant}`,
    touched: [touchedOpening(op.openingId)],
  };
}

/**
 * The geometry edit, and — with `wallId` — the move to another wall.
 *
 * A move insists on an ABSOLUTE `center`: `center` is a parameter
 * along one wall's centreline, so a delta against the wall the opening is
 * leaving would mean nothing on the wall it is joining, and a "move it 20 cm
 * to the right" that silently landed somewhere else is worse than a refusal.
 * Everything else is unchanged by the move: the same clamp `add_opening` runs
 * decides whether the opening fits its new wall.
 */
export function applySetOpening(scene: Draft<SceneData>, op: SetOpeningOp): OpOutcome {
  const found = findOpening(scene, op.openingId);
  if (!found) throw new OpError(`Unknown opening ${op.openingId}`);
  const destination = movedTo(scene, op, found);
  const current = effectiveOpening(found.opening, scene.ceilingHeight);
  const requested: OpeningGeometry = {
    center: op.center ?? current.center + (op.dcenter ?? 0),
    width: op.width ?? current.width + (op.dwidth ?? 0),
    sill: op.sill ?? current.sill + (op.dsill ?? 0),
    head: op.head ?? current.head + (op.dhead ?? 0),
  };
  for (const [key, value] of Object.entries(requested)) {
    if (!Number.isFinite(value)) throw new OpError(`set_opening ${op.openingId} got a non-finite ${key}`);
  }
  // An edit in place stays TOTAL — the clamp corrects whatever it is given —
  // while a MOVE runs the whole `add_opening` fit check on the wall it is
  // joining, because an opening landing on top of a neighbour is
  // not something a clamp can correct.
  const clamped = destination
    ? fitOntoWall(scene, destination, found.opening.type, requested, op.openingId)
    : clampOpening(found.opening.type, requested, {
        wallLength: wallCentrelineLength(scene, found.wall),
        ceilingHeight: scene.ceilingHeight,
      });
  writeGeometry(found.opening, clamped, scene.ceilingHeight);
  if (destination) {
    (found.wall.openings ?? []).splice(found.index, 1);
    destination.openings ??= [];
    destination.openings.push(found.opening);
  }
  const moved = destination ? `moved to wall ${destination.id} and set` : 'set';
  return {
    summary:
      `Opening ${op.openingId} ${moved} to centre ${round(clamped.center)} m, width ${round(clamped.width)} m, ` +
      `sill ${round(clamped.sill)} m, head ${round(clamped.head)} m`,
    touched: [TOUCHED_SHELL],
  };
}

/**
 * The wall a `set_opening` is moving its opening ONTO, or `null` when it is
 * editing the opening where it already hangs. Naming the wall the opening is
 * already on is an edit, not a move.
 */
function movedTo(scene: Draft<SceneData>, op: SetOpeningOp, found: OpeningLocation): Draft<Wall> | null {
  if (op.wallId === undefined || op.wallId === found.wall.id) return null;
  const wall = scene.walls.find((candidate) => candidate.id === op.wallId);
  if (!wall) throw new OpError(`Unknown wall ${op.wallId}`);
  if (op.dcenter !== undefined) {
    throw new OpError(`Moving opening ${op.openingId} to wall ${op.wallId} takes center, not dcenter`);
  }
  if (op.center === undefined) {
    throw new OpError(`Moving opening ${op.openingId} to wall ${op.wallId} needs an absolute center`);
  }
  return wall;
}

export function applyAddOpening(scene: Draft<SceneData>, op: AddOpeningOp): OpOutcome {
  const id = requireNewId(scene, op.id, 'add_opening');
  const wall = scene.walls.find((candidate) => candidate.id === op.wallId);
  if (!wall) throw new OpError(`Unknown wall ${op.wallId}`);
  if (op.type !== 'door' && op.type !== 'window' && op.type !== 'passage') {
    throw new OpError(`Unknown opening type ${String(op.type)}`);
  }
  if (op.entrance) {
    if (op.type !== 'door') throw new OpError('Only a door can be the entrance');
    const existing = entranceOpening(scene);
    if (existing) throw new OpError(`The scene already has an entrance (${existing.opening.id})`);
  }
  const doorLike = isDoorLike(op.type);
  const clamped = fitOntoWall(scene, wall, op.type, {
    center: op.center,
    width: op.width,
    sill: op.sill ?? DEFAULT_WINDOW_SILL,
    head: op.head ?? (doorLike ? DEFAULT_DOOR_HEAD : DEFAULT_WINDOW_HEAD),
  });
  const opening: Draft<Opening> = { id, type: op.type, center: clamped.center, width: clamped.width };
  if (op.entrance) opening.entrance = true;
  if (op.variant) opening.variant = op.variant;
  writeGeometry(opening, clamped, scene.ceilingHeight);
  wall.openings ??= [];
  wall.openings.push(opening);
  return { summary: `Added ${op.type} ${id} to wall ${op.wallId}`, touched: [TOUCHED_SHELL] };
}

export function applyRemoveOpening(scene: Draft<SceneData>, op: RemoveOpeningOp): OpOutcome {
  const found = findOpening(scene, op.openingId);
  if (!found) throw new OpError(`Unknown opening ${op.openingId}`);
  if (found.opening.entrance) {
    throw new OpError(
      `Opening ${op.openingId} is the entrance door; move it with set_opening or mark another door as the entrance before removing it`,
    );
  }
  (found.wall.openings ?? []).splice(found.index, 1);
  forgetOpeningInPresets(scene, op.openingId);
  return { summary: `Removed opening ${op.openingId} from wall ${found.wall.id}`, touched: [TOUCHED_SHELL] };
}

/**
 * Drops a removed opening out of every interior preset that dressed it
 * (`context.forgetInPresets`).
 *
 * `shell.ts` calls it too, once per opening a removed wall took with it: the
 * rule is about an opening ceasing to exist, not about which operation ended
 * it.
 */
export function forgetOpeningInPresets(scene: Draft<SceneData>, openingId: string): void {
  forgetInPresets(scene, (op) => op.op === 'replace_opening_variant' && op.openingId === openingId);
}
