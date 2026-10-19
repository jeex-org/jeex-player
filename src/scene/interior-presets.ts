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
 * the appliers take one.
 */

import { roomWallFinishOf, type InteriorPreset, type SceneOp } from './scene-ops.js';
import type { ApplyResult } from './scene-model.js';
import type { SceneRegistries } from './registries.js';
import type { Committed } from '../shared/committed.js';
import { sameFace } from './types.js';
import type { FaceKey, SceneData } from './types.js';

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
    else if (op.op === 'set_material') {
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
    if (op.op !== 'set_material' || registries.finishKind(op.material) !== 'wall') continue;
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
    ops.push({ op: 'set_material', target: owner, material: roomWallFinishOf(scene, owner) });
    cleared.add(owner);
  }
  return ops;
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
