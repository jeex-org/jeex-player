/**
 * What a room surface's finish value is DRAWN as: the legacy `Finish` of the
 * bundled bank, a generator or a flat `pbr` material, through the path it has
 * always taken, or a library material with the tint and the rotation the
 * finish value gives it.
 *
 * A project material of the `library` member is a library draw; so is a
 * bundled finish the built-in table binds (`builtin-library.ts`), unless the
 * project ships a material of any kind under the same id, which wins. The
 * scene validator has already refused a finish object naming anything but a
 * project library material, so a modifier never reaches the legacy path.
 * Pure module: no `three`.
 */

import { finishMaterialOf } from '../scene/finish-value.js';
import type { FinishRef } from '../scene/types.js';
import type { Finish } from './finish-catalogue.js';
import type { LibraryMaterial, ProjectMaterial } from './finish-types.js';
import { BUILTIN_FINISHES } from './builtin-library.js';

/** A library material as one surface draws it. */
export type LibraryDraw = {
  /** The project material's id. */
  readonly id: string;
  readonly material: LibraryMaterial;
  /** The finish value's tint, `#rrggbb`; a natural material ignores it. */
  readonly colour?: string;
  /** Degrees, counter-clockwise from the automatic grain orientation; 0 when the value names none. */
  readonly rotation: number;
  /** Set on a bundled finish: its maps ship beside the player, not in the document's project. */
  readonly builtin?: true;
};

/** A room surface's finish as the renderer draws it. */
export type RoomFinishDraw =
  | { readonly kind: 'legacy'; readonly finish: Finish }
  | { readonly kind: 'library'; readonly draw: LibraryDraw };

/**
 * The draw of `ref`: a library draw for a project library material, else the
 * legacy finish `legacy` answers for its id; `null` when neither knows it.
 */
export function resolveRoomFinish(
  ref: FinishRef,
  materials: readonly ProjectMaterial[] | undefined,
  legacy: (id: string) => Finish | null,
): RoomFinishDraw | null {
  const id = finishMaterialOf(ref);
  const project = materials?.find((candidate) => candidate.id === id);
  if (project !== undefined && 'library' in project) {
    const colour = typeof ref === 'string' ? undefined : ref.colour;
    const rotation = typeof ref === 'string' ? 0 : (ref.rotation ?? 0);
    return { kind: 'library', draw: { id, material: project.library, ...(colour !== undefined && { colour }), rotation } };
  }
  const builtin = project === undefined ? BUILTIN_FINISHES.get(id) : undefined;
  if (builtin !== undefined) {
    const { material, colour, rotation } = builtin;
    return { kind: 'library', draw: { id, material, ...(colour !== undefined && { colour }), rotation, builtin: true } };
  }
  const finish = legacy(id);
  return finish === null ? null : { kind: 'legacy', finish };
}
