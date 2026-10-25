/**
 * The room operations: `add_room`, `set_room`, `remove_room`.
 *
 * A room is an ANCHOR and a name, not an outline: the face of the wall graph
 * that contains the anchor IS the room (`types.Room.anchor`). So nothing here
 * draws anything — the three appliers only say where the anchor sits and what
 * the room is called, and whether that anchor actually lands inside a face no
 * other room has claimed is a question only the solver can answer. `SceneModel.apply` asks it, on the candidate document, before the
 * batch commits; an applier that tried to answer it would have to re-solve the
 * plan once per operation and would still be overruled.
 *
 * What a REMOVAL owns, on the other hand, is everything that only made sense
 * with the room: furniture bound to it, its camera, its painted finishes, the
 * per-face overrides its faces carried and the preset operations that named
 * it. Leaving any of them behind would make a perfectly reasonable
 * `remove_room` fail validation on a reference to a room that is gone.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Draft } from '../../shared/committed.js';
import type { SceneRegistries } from '../registries.js';
import { ROOM_PURPOSES, isMemberOf } from '../schema-sets.js';
import { schemaVersionBefore } from '../types.js';
import type { AddRoomOp, RemoveRoomOp, Room, SceneData, SceneOp, SetMaterialOp, SetRoomOp, SetRoomPurposeOp, Vec2 } from '../types.js';
import {
  OpError,
  TOUCHED_SHELL,
  dropFaceFinishes,
  forgetInPresets,
  requireFinite,
  requireNewId,
  touchedAsset,
  touchedFace,
  touchedFloor,
  touchedRoomWalls,
  type OpOutcome,
  type TouchedEntity,
} from './context.js';
import { ROOM_NAME_MAX } from './limits.js';

/** `(x, z)` for a summary line: two decimals, so two anchors read as one column. */
function anchorText(anchor: Vec2): string {
  return `(${anchor.x.toFixed(2)}, ${anchor.z.toFixed(2)})`;
}

/** A name a room may carry: something other than whitespace, at most `ROOM_NAME_MAX` characters. */
function requireRoomName(name: string, op: string): void {
  if (name.trim().length === 0) throw new OpError(`${op} needs a name`);
  if (name.length > ROOM_NAME_MAX) throw new OpError(`Room name is longer than ${ROOM_NAME_MAX} characters`);
}

function requireAnchor(anchor: Vec2, op: string): void {
  requireFinite(anchor.x, 'anchor.x', op);
  requireFinite(anchor.z, 'anchor.z', op);
}

function findRoom(scene: Draft<SceneData>, roomId: string): Draft<Room> {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) throw new OpError(`Unknown room ${roomId}`);
  return room;
}

export function applyAddRoom(scene: Draft<SceneData>, op: AddRoomOp, registries: SceneRegistries): OpOutcome {
  const id = requireNewId(scene, op.id, 'add_room');
  requireRoomName(op.name, 'add_room');
  requireAnchor(op.anchor, 'add_room');
  if (op.floorMaterial !== undefined) {
    if (!registries.isFinish(op.floorMaterial)) throw new OpError(`Unknown finish ${op.floorMaterial}`);
    if (registries.finishKind(op.floorMaterial) !== 'floor') throw new OpError(`${op.floorMaterial} is not a floor finish`);
  }
  // The default is the REGISTRIES', never a catalogue id written
  // into the scene layer: a project library that never heard of the bank's
  // floors would otherwise have the validator refuse the room this operation
  // just made.
  const floorMaterial = op.floorMaterial ?? registries.defaultFloorFinish;
  if (floorMaterial === undefined) throw new OpError('add_room needs a floorMaterial: these registries declare no default floor finish');
  const room: Draft<Room> = {
    id,
    name: op.name,
    anchor: { x: op.anchor.x, z: op.anchor.z },
    floorMaterial,
  };
  if (op.kind !== undefined) room.kind = op.kind;
  if (op.accent !== undefined) room.accent = op.accent;
  scene.rooms.push(room);
  return {
    summary: `Room ${id}: added ${op.name} at ${anchorText(room.anchor)}`,
    touched: [TOUCHED_SHELL, touchedFloor(id)],
  };
}

export function applySetRoom(scene: Draft<SceneData>, op: SetRoomOp): OpOutcome {
  const room = findRoom(scene, op.roomId);
  const changes: string[] = [];

  if (op.name !== undefined) {
    requireRoomName(op.name, 'set_room');
    changes.push(`name ${room.name} → ${op.name}`);
    room.name = op.name;
  }
  if (op.kind !== undefined) {
    changes.push(`kind ${room.kind ?? 'room'} → ${op.kind}`);
    room.kind = op.kind;
  }
  if (op.anchor !== undefined) {
    requireAnchor(op.anchor, 'set_room');
    changes.push(`anchor ${anchorText(room.anchor)} → ${anchorText(op.anchor)}`);
    room.anchor = { x: op.anchor.x, z: op.anchor.z };
  }
  if (op.accent !== undefined) {
    changes.push(`accent → ${op.accent}`);
    room.accent = op.accent;
  }
  if (changes.length === 0) throw new OpError('set_room needs at least one field to change');

  // Every one of the four reaches the drawing: the 2D plan letters the room
  // with its name and tints it with its accent, and a loggia is solved without
  // a ceiling. There is no metadata-only change to a room.
  return { summary: `Room ${op.roomId}: ${changes.join(', ')}`, touched: [TOUCHED_SHELL] };
}

export function applyRemoveRoom(scene: Draft<SceneData>, op: RemoveRoomOp): OpOutcome {
  const room = findRoom(scene, op.roomId);
  const touched: TouchedEntity[] = [TOUCHED_SHELL];
  const notes: string[] = [];

  scene.rooms.splice(scene.rooms.indexOf(room), 1);

  if (scene.roomCameras[op.roomId] !== undefined) {
    delete scene.roomCameras[op.roomId];
    notes.push('room camera dropped');
  }

  const rooms = scene.finishes?.rooms;
  const hadRoomFinish = rooms !== undefined && Object.prototype.hasOwnProperty.call(rooms, op.roomId);
  if (hadRoomFinish) {
    delete rooms[op.roomId];
    touched.push(touchedFloor(op.roomId), touchedRoomWalls(op.roomId));
  }
  const droppedFaces = dropFaceFinishes(scene, (face) => face.room === op.roomId);
  for (const face of droppedFaces) touched.push(touchedFace(face));
  if (hadRoomFinish || droppedFaces.length > 0) notes.push('finishes dropped');

  let unbound = 0;
  for (const asset of scene.assets) {
    if (asset.room !== op.roomId) continue;
    delete asset.room;
    touched.push(touchedAsset(asset.id));
    unbound += 1;
  }
  if (unbound > 0) notes.unshift(`${unbound} object${unbound === 1 ? '' : 's'} unbound`);

  forgetInPresets(scene, (candidate) => presetNamesRoom(candidate, op.roomId));

  const tail = notes.length === 0 ? '' : `, ${notes.join(', ')}`;
  return { summary: `Room ${op.roomId}: removed ${room.name}${tail}`, touched };
}

/**
 * `set_room_purpose`: what a room is for, from the closed vocabulary (schema
 * 2.4).
 *
 * The applier checks everything the op schema checks (`types.schema.ts`) for a
 * caller that applies an operation without parsing it first, refuses a
 * pre-2.4 document and never raises the version: the caller does. A purpose
 * draws nothing — the plan, the finishes and the furniture are exactly what
 * they were — so `touched` is empty and no revision rebuilds the scene.
 */
export function applySetRoomPurpose(scene: Draft<SceneData>, op: SetRoomPurposeOp): OpOutcome {
  if (schemaVersionBefore(scene.schemaVersion, '2.4')) {
    throw new OpError(`set_room_purpose needs scene schema 2.4; this document is ${scene.schemaVersion}`);
  }
  const room = findRoom(scene, op.roomId);
  const purpose: unknown = (op as { purpose?: unknown }).purpose;
  if (purpose !== null && !isMemberOf(ROOM_PURPOSES, purpose)) {
    // A word is named as it was written; anything else goes through JSON, the
    // way the id registry names a value that is not a string.
    const named = typeof purpose === 'string' ? purpose : (JSON.stringify(purpose) ?? 'undefined');
    throw new OpError(`Unknown room purpose ${named}`);
  }
  const previous = room.purpose ?? 'none';
  if (purpose === null) delete room.purpose;
  else room.purpose = purpose;
  return { summary: `Room ${op.roomId}: purpose ${previous} → ${purpose ?? 'none'}`, touched: [] };
}

/**
 * True when a `set_material` paints the room itself or one of its faces, in
 * either form: the legacy `target` (the room or a face it owns), or the
 * explicit `room` / `face.room`.
 *
 * Shared with the commit-time room merge (`scene/room-merge.ts`), which
 * forgets the instructions naming an absorbed room by the same test.
 */
export function namesRoom(op: SetMaterialOp, roomId: string): boolean {
  if (op.surface !== undefined) return op.room === roomId || op.face?.room === roomId;
  const target = op.target;
  return typeof target === 'object' ? target.room === roomId : target === roomId;
}

/**
 * True when a preset instruction names the room in any field: a `set_material`
 * in either form (`namesRoom`), a room camera, or the `room` /
 * `roomId` of any other preset-legal operation.
 */
export function presetNamesRoom(op: SceneOp, roomId: string): boolean {
  if (op.op === 'set_material') return namesRoom(op, roomId);
  if (op.op === 'set_camera') return typeof op.target === 'object' && op.target.room === roomId;
  const fields = op as { readonly room?: unknown; readonly roomId?: unknown };
  return fields.room === roomId || fields.roomId === roomId;
}
