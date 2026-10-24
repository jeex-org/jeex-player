/**
 * `shellInputsHash`: the digest of exactly the scene inputs the apartment
 * shell is built from, so a light bake is applied only to the revision it was
 * made for.
 *
 * In the digest: the plan (`units`, `storey`, `ceilingHeight`, `nodes`,
 * `walls` with their openings and variants, `rooms`), the scene-local
 * `materials`, the painted `finishes`, and the project materials a room or a
 * finish value names or a surface falls back to (their facts give the albedo
 * the bake bounces). Out of it: furniture, cameras, tours, presets, the
 * site's orientation (the sidecar pins the sun), every name, and the fields no
 * shell builder reads: a room's `accent` and `purpose` and a wall's `role`
 * (a hint for the UI and the validator).
 *
 * The digest is SHA-256 over a canonical JSON (keys sorted at every level,
 * arrays in order, `undefined` dropped) and reads `sha256:<hex>`. It never
 * reads a built mesh, so a change to the player's shell code does not
 * invalidate a bake, and two exports with different id minters give the same
 * digest.
 *
 * Pure module: no `three`, no DOM (`crypto.subtle` only).
 */

import { FINISH } from '../materials/finish-ids.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import { DEFAULT_WALL_FINISH } from '../scene/scene-ops.js';
import { finishMaterialOf } from '../scene/finish-value.js';
import type { FinishRef, SceneData } from '../scene/types.js';

/** Version of the digest's input selection; bumping it invalidates every bake. */
const SHELL_INPUTS_FORMAT = 1;

/** JSON with sorted keys at every level; `undefined` members are dropped like `JSON.stringify` does. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/**
 * The finishes a surface wears when the scene names none: unpainted walls,
 * the facade and junction cores wear the default wall finish, ceilings the
 * bundled plaster. A project material with one of these ids replaces the
 * bundled one, so it is an input like any named finish.
 */
const DEFAULT_FINISHES = [DEFAULT_WALL_FINISH, FINISH.plaster_white];

/** Every material id the shell's finish values name, and the defaults surfaces fall back to. */
function namedMaterials(scene: SceneData): Set<string> {
  const ids = new Set<string>(DEFAULT_FINISHES);
  const add = (ref: FinishRef | undefined): void => {
    if (ref !== undefined) ids.add(finishMaterialOf(ref));
  };
  for (const room of scene.rooms) ids.add(room.floorMaterial);
  for (const room of Object.values(scene.finishes?.rooms ?? {})) {
    add(room.floor);
    add(room.walls);
    add(room.ceiling);
    add(room.trim);
  }
  for (const face of scene.finishes?.faces ?? []) add(face.finish);
  add(scene.finishes?.facade);
  return ids;
}

/** The selection the digest is taken over (exposed for tests and for a reader debugging a mismatch). */
export function shellInputs(scene: SceneData, projectMaterials: readonly ProjectMaterial[] = []): unknown {
  const named = namedMaterials(scene);
  return {
    format: SHELL_INPUTS_FORMAT,
    units: scene.units,
    storey: scene.storey,
    ceilingHeight: scene.ceilingHeight,
    nodes: scene.nodes,
    walls: scene.walls.map(({ role: _role, ...wall }) => wall),
    rooms: scene.rooms.map(({ name: _name, accent: _accent, purpose: _purpose, ...room }) => room),
    materials: scene.materials,
    finishes: scene.finishes,
    projectMaterials: projectMaterials
      .filter((material) => named.has(material.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/** `sha256:<hex>` of the scene's shell inputs. */
export async function shellInputsHash(scene: SceneData, projectMaterials: readonly ProjectMaterial[] = []): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(shellInputs(scene, projectMaterials)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
