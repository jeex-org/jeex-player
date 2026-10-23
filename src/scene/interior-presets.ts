/**
 * Interior presets: turning one `SceneData.interiors` entry into the single
 * batch that applies it.
 *
 * A preset is data (`scene-ops.InteriorPreset`) and its `ops` are ordinary
 * `SceneOp`s, so this module adds no semantics of its own. What it does add is
 * the ONE guarantee a "complete look" needs and a bare list of operations does
 * not: after a preset applies, no wall face of a room the preset touches still
 * carries an earlier per-face override. `set_material` on a room already drops
 * that room's face overrides, so a preset that repaints a room's walls needs
 * nothing extra; a preset that only re-floors a room gets an explicit reset op
 * appended, repainting those walls with the finish they already have.
 *
 * Pure module: no `three`, no DOM. `SceneModel` is referenced only through the
 * structural `PresetModel` and a type-only import, so nothing here depends on
 * the model at runtime — and the finish catalogue it needs to tell a floor
 * finish from a wall one arrives through `SceneRegistries`, for the same reason
 * the appliers take one. That inference is the LEGACY form's only: an explicit
 * `set_material` names its surface, and coverage and the reset read it.
 */

import { roomWallFinishRefOf, type InteriorPreset, type SceneOp } from './scene-ops.js';
import type { ApplyResult } from './scene-model.js';
import type { SceneRegistries } from './registries.js';
import type { Committed } from '../shared/committed.js';
import { sameFace } from './types.js';
import type { FaceKey, SceneData, SetMaterialOp, SetMaterialSurfaceOp } from './types.js';

/**
 * What applying a preset needs of a `SceneModel`. Structural on purpose: the
 * model imports the validator, which knows about presets, so a runtime import
 * back would close a cycle.
 */
export type PresetModel = {
  readonly rev: number;
  readonly scene: Committed<SceneData>;
  /** The registries the model validates and applies against. */
  readonly registries: SceneRegistries;
  apply(batch: { baseRev: number; ops: readonly SceneOp[]; actor?: string | undefined }): ApplyResult;
};

/** Everything one preset changes, by kind. Ids are unique and in op order. */
export type PresetCoverage = {
  rooms: string[];
  assets: string[];
  openings: string[];
  /** Faces the preset paints on their own (`scope: 'face'`). */
  faces: FaceKey[];
};

/** The preset with that id, or `null`. Ids are unique across the scene. */
export function findPreset(scene: SceneData, presetId: string): InteriorPreset | null {
  return (scene.interiors ?? []).find((preset) => preset.id === presetId) ?? null;
}

/** The look the scene ships: the first preset, by the authoring convention. */
export function standardPreset(scene: SceneData): InteriorPreset | null {
  return scene.interiors?.[0] ?? null;
}

function push(list: string[], id: string | null | undefined): void {
  if (id && !list.includes(id)) list.push(id);
}

function pushFace(list: FaceKey[], face: FaceKey): void {
  if (!list.some((listed) => sameFace(listed, face))) list.push(face);
}

/** The explicit `set_material` form, told apart by its `surface` key; the legacy form has none. */
function isExplicit(op: SetMaterialOp): op is SetMaterialSurfaceOp {
  return op.surface !== undefined;
}

/**
 * Which rooms, placements and openings a preset touches — the panel's footer
 * copy, and what the tests measure coverage against.
 */
export function presetCoverage(scene: SceneData, preset: InteriorPreset): PresetCoverage {
  const coverage: PresetCoverage = { rooms: [], assets: [], openings: [], faces: [] };
  const everyRoom = (): void => {
    for (const room of scene.rooms) push(coverage.rooms, room.id);
  };
  for (const op of preset.ops) {
    if (op.op === 'replace_asset_variant') push(coverage.assets, op.assetId);
    else if (op.op === 'replace_opening_variant') push(coverage.openings, op.openingId);
    else if (op.op === 'set_material' && isExplicit(op)) {
      // The explicit form says where it paints: a face, a room, the facade, or every room.
      if (op.face !== undefined) {
        push(coverage.rooms, op.face.room);
        pushFace(coverage.faces, op.face);
      } else if (op.surface === 'facade') continue;
      else if (op.room === undefined) everyRoom();
      else push(coverage.rooms, op.room);
    } else if (op.op === 'set_material') {
      if (op.target === 'floors' || op.target === 'walls') everyRoom();
      else if (op.target === 'facade') continue;
      else if (typeof op.target === 'object') {
        push(coverage.rooms, op.target.room);
        if (op.scope !== 'room') pushFace(coverage.faces, op.target);
      } else push(coverage.rooms, op.target);
    }
  }
  return coverage;
}

/**
 * Rooms whose WALLS the preset repaints. `set_material` clears the face
 * overrides of exactly these rooms on its own, which is why they need no
 * explicit reset.
 */
function roomsRepaintedOnWalls(scene: SceneData, preset: InteriorPreset, registries: SceneRegistries): Set<string> {
  const rooms = new Set<string>();
  for (const op of preset.ops) {
    if (op.op !== 'set_material') continue;
    if (isExplicit(op)) {
      // Read from `surface`, never inferred: a face operation repaints one
      // face and clears nothing; a room or every-room wall paint clears.
      if (op.surface !== 'wall' || op.face !== undefined) continue;
      if (op.room === undefined) for (const room of scene.rooms) rooms.add(room.id);
      else rooms.add(op.room);
      continue;
    }
    if (registries.finishKind(op.material) !== 'wall') continue;
    if (op.target === 'walls') {
      for (const room of scene.rooms) rooms.add(room.id);
    } else if (op.target === 'facade' || op.target === 'floors') {
      continue;
    } else if (typeof op.target === 'object') {
      const owner = op.target.room;
      if (owner !== undefined && op.scope === 'room') rooms.add(owner);
    } else {
      rooms.add(op.target);
    }
  }
  return rooms;
}

/**
 * The batch that applies a preset: its own operations, plus a reset for every
 * room the preset touches that still carries per-face overrides its own
 * operations would not clear. The facade keeps its overrides — a preset dresses
 * the interior.
 */
export function presetBatchOps(scene: SceneData, preset: InteriorPreset, registries: SceneRegistries): SceneOp[] {
  const ops: SceneOp[] = [...preset.ops];
  const touched = presetCoverage(scene, preset).rooms;
  const cleared = roomsRepaintedOnWalls(scene, preset, registries);
  for (const face of scene.finishes?.faces ?? []) {
    const owner = face.room;
    if (owner === undefined || cleared.has(owner) || !touched.includes(owner)) continue;
    // Repainting the room with the finish it already has is what drops the
    // override: the paint is a no-op, the reset is the point.
    ops.push(resetOp(scene, owner, registries));
    cleared.add(owner);
  }
  return ops;
}

/**
 * The operation that repaints a room's walls with the finish they already
 * wear, in its exact spelling.
 *
 * A bare finish the legacy form routes to the walls stays in that form, as it
 * always was written. Anything else goes through the explicit form, which
 * names the surface: a finish object (whose colour and rotation only that
 * form can write) and a bare finish the legacy form would infer as a FLOOR (a
 * material that dresses both).
 */
function resetOp(scene: SceneData, room: string, registries: SceneRegistries): SceneOp {
  const walls = roomWallFinishRefOf(scene, room);
  if (typeof walls === 'string') {
    if (registries.finishKind(walls) === 'wall') return { op: 'set_material', target: room, material: walls };
    return { op: 'set_material', surface: 'wall', room, material: walls };
  }
  return {
    op: 'set_material',
    surface: 'wall',
    room,
    material: walls.material,
    ...(walls.colour !== undefined && { colour: walls.colour }),
    ...(walls.rotation !== undefined && { rotation: walls.rotation }),
  };
}

/**
 * Applies a preset as ONE revision. Returns the model's own `ApplyResult`, so a
 * caller reports a refusal exactly as it reports any other refused batch.
 */
export function applyPresetBatch(model: PresetModel, presetId: string, actor?: string): ApplyResult {
  const preset = findPreset(model.scene, presetId);
  if (!preset) return { error: 'validation_failed', message: `Unknown interior preset ${presetId}` };
  return model.apply({ baseRev: model.rev, ops: presetBatchOps(model.scene, preset, model.registries), actor });
}
