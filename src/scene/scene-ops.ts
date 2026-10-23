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
import { isLibraryMaterialIn, surfacesIn, type SceneRegistries } from './registries.js';
import type {
  FaceKey,
  FinishRef,
  FinishSurface,
  RoomFinishes,
  SceneData,
  SceneFinishes,
  SceneOp,
  SetMaterialOp,
  SetMaterialSurfaceOp,
  SetMaterialTargetOp,
} from './types.js';
import { applySetSite } from './ops/site.js';
import { faceKey, isFaceKey, sameFace } from './types.js';
import { finishMaterialOf, finishRefProblem } from './finish-value.js';
import {
  OpError,
  TOUCHED_FACADE,
  dropFaceFinishes,
  faceText,
  touchedCeiling,
  touchedFace,
  touchedFloor,
  touchedRoomWalls,
  touchedTrim,
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
import { applyAddRoom, applyRemoveRoom, applySetRoom, applySetRoomPurpose } from './ops/rooms.js';
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
  TOUCHED_SITE,
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

// Two projections per surface: `…RefOf` answers with the finish value whole,
// modifiers included, which is what a repaint and a preset's reset need; the
// published `…FinishOf` answers with the material UUID it names, the question
// a picker, a debug panel and a host ask.

/** Effective floor finish value of a room: the painted override, else the authored default. */
export function floorFinishRefOf(scene: SceneData, roomId: string): FinishRef | null {
  const override = own(scene.finishes?.rooms, roomId)?.floor;
  if (override) return override;
  return scene.rooms.find((room) => room.id === roomId)?.floorMaterial ?? null;
}

/** Effective wall finish value of a room. */
export function roomWallFinishRefOf(scene: SceneData, roomId: string): FinishRef {
  return own(scene.finishes?.rooms, roomId)?.walls ?? DEFAULT_WALL_FINISH;
}

/** Effective facade finish value. */
export function facadeFinishRefOf(scene: SceneData): FinishRef {
  return scene.finishes?.facade ?? DEFAULT_WALL_FINISH;
}

/**
 * Effective finish value of one wall face: its own entry in `finishes.faces`,
 * else its owner's — the room named by `face.room`, or the facade when it has none.
 */
export function faceFinishRefOf(scene: SceneData, face: FaceKey): FinishRef {
  const override = scene.finishes?.faces?.find((entry) => sameFace(entry, face))?.finish;
  if (override) return override;
  return face.room === undefined ? facadeFinishRefOf(scene) : roomWallFinishRefOf(scene, face.room);
}

/** Effective floor finish of a room (its material UUID): the painted override, else the authored default. */
export function floorFinishOf(scene: SceneData, roomId: string): string | null {
  const ref = floorFinishRefOf(scene, roomId);
  return ref === null ? null : finishMaterialOf(ref);
}

/** Effective wall finish of a room (its material UUID). */
export function roomWallFinishOf(scene: SceneData, roomId: string): string {
  return finishMaterialOf(roomWallFinishRefOf(scene, roomId));
}

/** Effective facade finish (its material UUID). */
export function facadeFinishOf(scene: SceneData): string {
  return finishMaterialOf(facadeFinishRefOf(scene));
}

/** Effective finish of one wall face (its material UUID). */
export function faceFinishOf(scene: SceneData, face: FaceKey): string {
  return finishMaterialOf(faceFinishRefOf(scene, face));
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
function setFaceFinish(scene: Draft<SceneData>, face: FaceKey, finish: FinishRef): void {
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
    case 'set_room_purpose':
      return applySetRoomPurpose(scene, op);
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
    case 'set_site':
      return applySetSite(scene, op);
    default: {
      const unknown = op as { op?: unknown };
      throw new OpError(`Unknown operation ${String(unknown.op)}`);
    }
  }
}

// --------------------------------------------------------- set_material ------

/**
 * `set_material`, either form. The form is told by its key — `surface` is the
 * explicit one, `target` the legacy one — and an operation carrying both is
 * refused rather than read one way.
 */
function applySetMaterial(scene: Draft<SceneData>, op: SetMaterialOp, registries: SceneRegistries): OpOutcome {
  const keys = op as { surface?: unknown; target?: unknown };
  if (keys.surface !== undefined && keys.target !== undefined) {
    throw new OpError('set_material takes either target or surface, not both');
  }
  if (keys.surface !== undefined) return applySetMaterialSurface(scene, op as SetMaterialSurfaceOp, registries);
  return applySetMaterialTarget(scene, op as SetMaterialTargetOp, registries);
}

/**
 * The legacy form: the surface is INFERRED from the finish, on the surface
 * table (`finishSurfaces`) with the compatibility a bare UUID has always had —
 * a finish that dresses walls also dresses the facade.
 */
function applySetMaterialTarget(scene: Draft<SceneData>, op: SetMaterialTargetOp, registries: SceneRegistries): OpOutcome {
  if (!registries.isFinish(op.material)) throw new OpError(`Unknown finish ${op.material}`);
  const surfaces = surfacesIn(registries, op.material);

  if (op.target === 'floors') {
    if (!surfaces.has('floor')) throw new OpError(`${op.material} is not a floor finish`);
    const touched: TouchedEntity[] = [];
    for (const room of scene.rooms) {
      roomEntry(scene, room.id).floor = op.material;
      touched.push(touchedFloor(room.id));
    }
    return { summary: `Floor finish ${op.material} applied to every room`, touched };
  }

  if (op.target === 'walls') {
    if (!surfaces.has('wall')) throw new OpError(`${op.material} is not a wall finish`);
    const touched: TouchedEntity[] = [];
    for (const room of scene.rooms) {
      roomEntry(scene, room.id).walls = op.material;
      touched.push(touchedRoomWalls(room.id));
    }
    clearRoomFaceOverrides(scene);
    return { summary: `Wall finish ${op.material} applied to every room`, touched };
  }

  if (op.target === 'facade') {
    if (!dressesFacade(surfaces)) throw new OpError(`${op.material} is not a wall finish`);
    finishesOf(scene).facade = op.material;
    clearOwnedFaceOverrides(scene, null);
    return { summary: `Facade finish set to ${op.material}`, touched: [TOUCHED_FACADE] };
  }

  // A face is a structure; every other target is a word or a room UUID.
  if (typeof op.target === 'object') return setFaceMaterial(scene, op.target, op, surfaces);

  const room = scene.rooms.find((candidate) => candidate.id === op.target);
  if (!room) throw new OpError(`Unknown set_material target ${op.target}`);
  if (surfaces.has('floor')) {
    roomEntry(scene, room.id).floor = op.material;
    return { summary: `Floor of ${room.name} set to ${op.material}`, touched: [touchedFloor(room.id)] };
  }
  if (!surfaces.has('wall')) throw new OpError(`${op.material} is not a wall finish`);
  roomEntry(scene, room.id).walls = op.material;
  clearOwnedFaceOverrides(scene, room.id);
  return { summary: `Walls of ${room.name} set to ${op.material}`, touched: [touchedRoomWalls(room.id)] };
}

/** Whether a bare finish may dress the facade: it says so, or it dresses walls (the 2.2 rule). */
function dressesFacade(surfaces: ReadonlySet<FinishSurface>): boolean {
  return surfaces.has('facade') || surfaces.has('wall');
}

function setFaceMaterial(
  scene: Draft<SceneData>,
  target: unknown,
  op: SetMaterialTargetOp,
  surfaces: ReadonlySet<FinishSurface>,
): OpOutcome {
  if (!dressesFacade(surfaces)) throw new OpError(`${op.material} is not a wall finish`);
  if (!isFaceKey(target)) throw new OpError('set_material target is not a wall face ({ room?, wallId, side })');
  if (!scene.walls.some((wall) => wall.id === target.wallId)) {
    throw new OpError(`Face ${faceText(target)} names unknown wall ${target.wallId}`);
  }
  const owner = target.room === undefined ? null : scene.rooms.find((room) => room.id === target.room);
  if (owner === undefined) throw new OpError(`Face ${faceText(target)} names unknown room ${target.room}`);
  // A room's face is a wall; only the facade's takes a facade-only finish.
  if (owner !== null && !surfaces.has('wall')) throw new OpError(`${op.material} is not a wall finish`);
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

/** The surface words of the explicit form. */
const SURFACES: ReadonlySet<unknown> = new Set<FinishSurface>(['floor', 'wall', 'ceiling', 'trim', 'facade']);

/** The room-entry key each per-room surface is written under. */
const ROOM_KEY = { floor: 'floor', wall: 'walls', ceiling: 'ceiling', trim: 'trim' } as const satisfies Record<
  Exclude<FinishSurface, 'facade'>,
  keyof RoomFinishes
>;

/** The touched entity of each per-room surface. */
const TOUCHED_ROOM = { floor: touchedFloor, wall: touchedRoomWalls, ceiling: touchedCeiling, trim: touchedTrim } as const;

/** The value the explicit form writes: the bare UUID without modifiers, the finish object with them. */
function finishValueOf(op: SetMaterialSurfaceOp): FinishRef {
  if (op.colour === undefined && op.rotation === undefined) return op.material;
  return {
    material: op.material,
    ...(op.colour !== undefined && { colour: op.colour }),
    ...(op.rotation !== undefined && { rotation: op.rotation }),
  };
}

/**
 * The explicit form: `surface` says what is painted, so nothing is inferred.
 *
 * Every check runs before the first write, so a refused operation leaves the
 * draft as it was: the addressing (`face` only for `wall` and `facade`, never
 * beside `room`; no `room` for `facade`), the strict surface table (the
 * material's `apply` must name the surface — no facade allowance here), the
 * modifiers (only a library material takes them, in the shape a finish
 * object has) and the version (a finish object, a ceiling or a trim is
 * refused in a 2.2 document, because an operation never changes a version).
 */
function applySetMaterialSurface(scene: Draft<SceneData>, op: SetMaterialSurfaceOp, registries: SceneRegistries): OpOutcome {
  const { surface, material } = op;
  if (!SURFACES.has(surface)) throw new OpError(`set_material surface ${surface} is not floor, wall, ceiling, trim or facade`);
  if (op.room !== undefined && op.face !== undefined) throw new OpError('set_material takes room or face, not both');
  if (op.face !== undefined && surface !== 'wall' && surface !== 'facade') {
    throw new OpError(`set_material face is allowed only for the wall and facade surfaces, not ${surface}`);
  }
  if (op.room !== undefined && surface === 'facade') throw new OpError('set_material room is not allowed for the facade surface');
  if (!registries.isFinish(material)) throw new OpError(`Unknown finish ${material}`);
  if (!surfacesIn(registries, material).has(surface)) throw new OpError(`${material} does not dress the ${surface} surface`);
  const value = finishValueOf(op);
  if (typeof value === 'object') {
    if (!isLibraryMaterialIn(registries, material)) {
      throw new OpError(`${material} takes no colour or rotation: modifiers need a library material`);
    }
    const problem = finishRefProblem(value);
    if (problem !== null) throw new OpError(`set_material finish ${problem}`);
  }
  if (scene.schemaVersion === '2.2' && (typeof value === 'object' || surface === 'ceiling' || surface === 'trim')) {
    const what = typeof value === 'object' ? 'a finish object' : `a ${surface} finish`;
    throw new OpError(`${what} needs scene schema 2.3; this document is 2.2`);
  }

  if (op.face !== undefined) return setExplicitFace(scene, op.face, surface, value);
  if (surface === 'facade') {
    finishesOf(scene).facade = value;
    clearOwnedFaceOverrides(scene, null);
    return { summary: `Facade finish set to ${material}`, touched: [TOUCHED_FACADE] };
  }
  const rooms = op.room === undefined ? scene.rooms : scene.rooms.filter((room) => room.id === op.room);
  if (rooms.length === 0) throw new OpError(`Unknown set_material room ${op.room}`);
  const touched: TouchedEntity[] = [];
  for (const room of rooms) {
    roomEntry(scene, room.id)[ROOM_KEY[surface]] = value;
    touched.push(TOUCHED_ROOM[surface](room.id));
  }
  if (surface === 'wall') {
    if (op.room === undefined) clearRoomFaceOverrides(scene);
    else clearOwnedFaceOverrides(scene, op.room);
  }
  const where = op.room === undefined ? 'every room' : rooms[0]!.name;
  return { summary: `${surface[0]!.toUpperCase()}${surface.slice(1)} finish ${material} applied to ${where}`, touched };
}

/** One face, painted by the explicit form: a room's face for `wall`, a face no room owns for `facade`. */
function setExplicitFace(scene: Draft<SceneData>, target: unknown, surface: FinishSurface, value: FinishRef): OpOutcome {
  if (!isFaceKey(target)) throw new OpError('set_material face is not a wall face ({ room?, wallId, side })');
  if (!scene.walls.some((wall) => wall.id === target.wallId)) {
    throw new OpError(`Face ${faceText(target)} names unknown wall ${target.wallId}`);
  }
  if (surface === 'wall' && target.room === undefined) throw new OpError('set_material wall face needs the room that owns it');
  if (surface === 'facade' && target.room !== undefined) throw new OpError('set_material facade face is owned by no room');
  if (target.room !== undefined && !scene.rooms.some((room) => room.id === target.room)) {
    throw new OpError(`Face ${faceText(target)} names unknown room ${target.room}`);
  }
  const face = faceKey(target.room ?? null, target.wallId, target.side);
  setFaceFinish(scene, face, value);
  return { summary: `Wall face ${faceText(face)} set to ${finishMaterialOf(value)}`, touched: [touchedFace(face)] };
}
