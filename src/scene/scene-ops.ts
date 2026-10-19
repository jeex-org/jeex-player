/**
 * The scene operation vocabulary: the DISPATCHER, the painting operation, and
 * the finish projections the rest of the app reads.
 *
 * The appliers themselves live one directory down, one module per group of
 * operations — `ops/shell.ts`, `ops/openings.ts`, `ops/assets.ts` — over the
 * shared `ops/context.ts` (the `OpError`, the `OpOutcome`, the touched-entity
 * vocabulary) and `ops/limits.ts` (every clamp, named). This file stays the one
 * door into all of them: everything those modules export that a caller outside
 * the scene layer ever asked for is re-exported here unchanged, so the split
 * changed no importer anywhere in the repository, and
 * `scene-ops.test.ts`'s vocabulary snapshot proves the summaries and touched
 * entities came out identical.
 *
 * `set_material` stays HERE rather than moving to a module of its own: it is
 * the operation over the painted state, and the finish projections below
 * (`floorFinishOf`, `faceFinishOf`, …) are the read side of exactly that state.
 * Splitting the writer from the readers would put one concept in two files.
 *
 * Every applier is handed the `SceneRegistries` an operation's references are
 * checked against (`registries.ts`) rather than importing the catalogues: an
 * op that names a finish or a variant has to be checked against the bank, and
 * importing the bank from here inverted the layer order.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Draft } from '../shared/committed.js';
import type { SceneRegistries } from './registries.js';
import type { FaceKey, RoomFinishes, SceneData, SceneFinishes, SceneOp, SetMaterialOp } from './types.js';
import { faceKey, isFaceKey, sameFace } from './types.js';
import {
  OpError,
  TOUCHED_FACADE,
  dropFaceFinishes,
  faceText,
  touchedFace,
  touchedFloor,
  touchedRoomWalls,
  type OpOutcome,
  type TouchedEntity,
} from './ops/context.js';
import {
  applyMoveObject,
  applyPlaceObject,
  applyRemoveObject,
  applyMirrorObject,
  applyReplaceAssetVariant,
  applyRotateObject,
  applySetObject,
} from './ops/assets.js';
import { applyAddRoom, applyRemoveRoom, applySetRoom } from './ops/rooms.js';
import {
  applyAddNode,
  applyAddWall,
  applyMoveNode,
  applyRemoveNode,
  applyRemoveWall,
  applySetCeiling,
  applySetWall,
  applySplitWall,
} from './ops/shell.js';
import { applyAddOpening, applyRemoveOpening, applyReplaceOpeningVariant, applySetOpening } from './ops/openings.js';
import { applySetAutotour, applySetCamera, applySetNavigation, applySetTourCheckpoints } from './ops/cameras.js';

/**
 * Wall finish every face starts from when nothing overrides it: the bundled
 * bank's warm sand plaster (`materials/finish-ids.FINISH.sand`). Spelled as
 * the literal because the scene layer sits below the catalogues and may not
 * import them; `scene-ops.test.ts` proves the bank knows it as a wall finish.
 */
export const DEFAULT_WALL_FINISH = '01a12fdf-1597-7e0c-8b3e-f091fb6af634';

// ------------------------------------------------------------ op vocabulary --
//
// The op vocabulary is scene DATA (`SceneData.interiors[].ops` is built from
// it), so the type declarations live in `types.ts` alongside `SceneData`
// itself — re-exported here unchanged so every existing importer of
// `scene-ops.SceneOp` / `scene-ops.InteriorPreset` etc. sees no difference.
export type { SceneOp, InteriorPreset } from './types.js';

// The applier toolkit and the clamps, re-exported for the same reason: the
// modules below are an internal arrangement of this file, not a new public
// surface (`embed/ops.ts` is what is public).
export {
  OpError,
  TOUCHED_FACADE,
  TOUCHED_SHELL,
  faceText,
  isTouchedAsset,
  isTouchedOpening,
  sameTouched,
  touchedAsset,
  touchedFace,
  touchedFloor,
  touchedOpening,
  touchedRoomWalls,
  wallCentrelineLength,
} from './ops/context.js';
export type { NewIdRefusal, OpOutcome, TouchedEntity } from './ops/context.js';
export { MAX_CEILING_HEIGHT } from './ops/limits.js';

// ------------------------------------------------------- finish projections --

/** Effective floor finish of a room: the painted override, else the authored default. */
export function floorFinishOf(scene: SceneData, roomId: string): string | null {
  const override = own(scene.finishes?.rooms, roomId)?.floor;
  if (override) return override;
  return scene.rooms.find((room) => room.id === roomId)?.floorMaterial ?? null;
}

/** Effective wall finish of a room. */
export function roomWallFinishOf(scene: SceneData, roomId: string): string {
  return own(scene.finishes?.rooms, roomId)?.walls ?? DEFAULT_WALL_FINISH;
}

export function facadeFinishOf(scene: SceneData): string {
  return scene.finishes?.facade ?? DEFAULT_WALL_FINISH;
}

/**
 * Effective finish of one wall face: its own entry in `finishes.faces`, else
 * its owner's — the room named by `face.room`, or the facade when it has none.
 */
export function faceFinishOf(scene: SceneData, face: FaceKey): string {
  const override = scene.finishes?.faces?.find((entry) => sameFace(entry, face))?.finish;
  if (override) return override;
  return face.room === undefined ? facadeFinishOf(scene) : roomWallFinishOf(scene, face.room);
}

// ------------------------------------------------------------------ helpers --

/**
 * A keyed record with no prototype.
 *
 * Room keys are UUIDs once the validator has run, but `finishes.rooms` is the
 * one place a caller-supplied string becomes an object key, so it never gets
 * an inherited `__proto__` to walk into.
 */
function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** `record[key]`, ignoring anything inherited from the prototype chain. */
function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  if (!record) return undefined;
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function finishesOf(scene: Draft<SceneData>): Draft<SceneFinishes> {
  scene.finishes ??= {};
  return scene.finishes;
}

/**
 * Paints `face` alone: its entry in `finishes.faces` is replaced in place, or
 * appended when it has none, so a repaint never reorders the list.
 */
function setFaceFinish(scene: Draft<SceneData>, face: FaceKey, finish: string): void {
  const all = finishesOf(scene);
  all.faces ??= [];
  const entry = { ...faceKey(face.room ?? null, face.wallId, face.side), finish };
  const index = all.faces.findIndex((candidate) => sameFace(candidate, face));
  if (index < 0) all.faces.push(entry);
  else all.faces[index] = entry;
}

function roomEntry(scene: Draft<SceneData>, roomId: string): Draft<RoomFinishes> {
  const all = finishesOf(scene);
  all.rooms ??= emptyRecord();
  const entry = own(all.rooms, roomId) ?? {};
  all.rooms[roomId] = entry;
  return entry;
}

/** Drops the per-face overrides of `room` (or of the facade, for `null`), so the owner's finish wins again. */
function clearOwnedFaceOverrides(scene: Draft<SceneData>, room: string | null): void {
  dropFaceFinishes(scene, (face) => (face.room ?? null) === room);
}

/** Drops every per-face override that belongs to a room (the facade keeps its own). */
function clearRoomFaceOverrides(scene: Draft<SceneData>): void {
  dropFaceFinishes(scene, (face) => face.room !== undefined);
}

// --------------------------------------------------------------- dispatch ----

/**
 * Applies one operation to a draft scene. The caller owns the draft and the
 * atomicity; this function only mutates and reports.
 */
export function applyOp(scene: Draft<SceneData>, op: SceneOp, registries: SceneRegistries): OpOutcome {
  try {
    return dispatchOp(scene, op, registries);
  } catch (error) {
    // The appliers name the finish, the opening or the asset they could not
    // use; only the DISPATCHER knows which operation asked. Re-raising here is
    // what puts `detail.op` on every refusal without threading the op name
    // through thirty call sites.
    if (error instanceof OpError && error.detail === undefined) {
      throw new OpError(error.message, (op as { op?: unknown }).op === undefined ? undefined : String((op as { op?: unknown }).op));
    }
    throw error;
  }
}

function dispatchOp(scene: Draft<SceneData>, op: SceneOp, registries: SceneRegistries): OpOutcome {
  switch (op.op) {
    case 'set_material':
      return applySetMaterial(scene, op, registries);
    case 'replace_asset_variant':
      return applyReplaceAssetVariant(scene, op, registries);
    case 'replace_opening_variant':
      return applyReplaceOpeningVariant(scene, op, registries);
    case 'set_ceiling':
      return applySetCeiling(scene, op);
    case 'set_opening':
      return applySetOpening(scene, op);
    case 'add_opening':
      return applyAddOpening(scene, op);
    case 'remove_opening':
      return applyRemoveOpening(scene, op);
    case 'set_camera':
      return applySetCamera(scene, op);
    case 'set_navigation':
      return applySetNavigation(scene, op);
    case 'set_autotour':
      return applySetAutotour(scene, op);
    case 'set_tour_checkpoints':
      return applySetTourCheckpoints(scene, op);
    case 'add_room':
      return applyAddRoom(scene, op, registries);
    case 'set_room':
      return applySetRoom(scene, op);
    case 'remove_room':
      return applyRemoveRoom(scene, op);
    case 'place_object':
      return applyPlaceObject(scene, op, registries);
    case 'move_object':
      return applyMoveObject(scene, op, registries);
    case 'rotate_object':
      return applyRotateObject(scene, op);
    case 'set_object':
      return applySetObject(scene, op, registries);
    case 'remove_object':
      return applyRemoveObject(scene, op);
    case 'mirror_object':
      return applyMirrorObject(scene, op, registries);
    case 'add_node':
      return applyAddNode(scene, op);
    case 'move_node':
      return applyMoveNode(scene, op);
    case 'remove_node':
      return applyRemoveNode(scene, op);
    case 'add_wall':
      return applyAddWall(scene, op);
    case 'set_wall':
      return applySetWall(scene, op);
    case 'remove_wall':
      return applyRemoveWall(scene, op);
    case 'split_wall':
      return applySplitWall(scene, op);
    default: {
      const unknown = op as { op?: unknown };
      throw new OpError(`Unknown operation ${String(unknown.op)}`);
    }
  }
}

// --------------------------------------------------------- set_material ------

function applySetMaterial(scene: Draft<SceneData>, op: SetMaterialOp, registries: SceneRegistries): OpOutcome {
  if (!registries.isFinish(op.material)) throw new OpError(`Unknown finish ${op.material}`);
  const kind = registries.finishKind(op.material);

  if (op.target === 'floors') {
    if (kind !== 'floor') throw new OpError(`${op.material} is not a floor finish`);
    const touched: TouchedEntity[] = [];
    for (const room of scene.rooms) {
      roomEntry(scene, room.id).floor = op.material;
      touched.push(touchedFloor(room.id));
    }
    return { summary: `Floor finish ${op.material} applied to every room`, touched };
  }

  if (op.target === 'walls') {
    if (kind !== 'wall') throw new OpError(`${op.material} is not a wall finish`);
    const touched: TouchedEntity[] = [];
    for (const room of scene.rooms) {
      roomEntry(scene, room.id).walls = op.material;
      touched.push(touchedRoomWalls(room.id));
    }
    clearRoomFaceOverrides(scene);
    return { summary: `Wall finish ${op.material} applied to every room`, touched };
  }

  if (op.target === 'facade') {
    if (kind !== 'wall') throw new OpError(`${op.material} is not a wall finish`);
    finishesOf(scene).facade = op.material;
    clearOwnedFaceOverrides(scene, null);
    return { summary: `Facade finish set to ${op.material}`, touched: [TOUCHED_FACADE] };
  }

  // A face is a structure; every other target is a word or a room UUID.
  if (typeof op.target === 'object') return setFaceMaterial(scene, op.target, op, kind);

  const room = scene.rooms.find((candidate) => candidate.id === op.target);
  if (!room) throw new OpError(`Unknown set_material target ${op.target}`);
  if (kind === 'floor') {
    roomEntry(scene, room.id).floor = op.material;
    return { summary: `Floor of ${room.name} set to ${op.material}`, touched: [touchedFloor(room.id)] };
  }
  roomEntry(scene, room.id).walls = op.material;
  clearOwnedFaceOverrides(scene, room.id);
  return { summary: `Walls of ${room.name} set to ${op.material}`, touched: [touchedRoomWalls(room.id)] };
}

function setFaceMaterial(scene: Draft<SceneData>, target: unknown, op: SetMaterialOp, kind: 'floor' | 'wall' | null): OpOutcome {
  if (kind !== 'wall') throw new OpError(`${op.material} is not a wall finish`);
  if (!isFaceKey(target)) throw new OpError('set_material target is not a wall face ({ room?, wallId, side })');
  if (!scene.walls.some((wall) => wall.id === target.wallId)) {
    throw new OpError(`Face ${faceText(target)} names unknown wall ${target.wallId}`);
  }
  const owner = target.room === undefined ? null : scene.rooms.find((room) => room.id === target.room);
  if (owner === undefined) throw new OpError(`Face ${faceText(target)} names unknown room ${target.room}`);
  if (op.scope === 'room') {
    if (owner === null) {
      finishesOf(scene).facade = op.material;
      clearOwnedFaceOverrides(scene, null);
      return { summary: `Facade finish set to ${op.material}`, touched: [TOUCHED_FACADE] };
    }
    roomEntry(scene, owner.id).walls = op.material;
    clearOwnedFaceOverrides(scene, owner.id);
    return { summary: `Walls of ${owner.name} set to ${op.material}`, touched: [touchedRoomWalls(owner.id)] };
  }
  const face = faceKey(owner?.id ?? null, target.wallId, target.side);
  setFaceFinish(scene, face, op.material);
  return { summary: `Wall face ${faceText(face)} set to ${op.material}`, touched: [touchedFace(face)] };
}
