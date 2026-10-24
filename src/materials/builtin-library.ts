/**
 * The bundled room finishes that draw a library material, as the renderer
 * reads them: one binding per bound finish id (its library material, the
 * tint it is drawn in and its grain rotation), and the ceiling every room
 * wears when it names none.
 *
 * Expanded once from the generated records (`builtin-library-data.ts`): a
 * map's path is `tex/<versionId>/<role>.<px>.webp`, relative to the
 * `finish-maps/` folder that ships next to the player file. A finish with no
 * binding here keeps the look the legacy catalogue gives it.
 *
 * Imported by the room-surface path and the picker only, never by
 * `finish-catalogue.ts`: the scene-operation entry has no use for maps.
 *
 * Pure module: no `three`, no DOM.
 */

import { BUILTIN_RECORDS, type BuiltinFinishRecord, type BuiltinVersionRecord } from './builtin-library-data.js';
import type { LibraryMap, LibraryMaterial } from './finish-types.js';
import { ViewerLibError } from '../shared/errors.js';

/** A bundled finish as a library draw needs it. */
export type BuiltinBinding = {
  readonly material: LibraryMaterial;
  /** The tint of a tintable material, `#rrggbb`. */
  readonly colour?: string;
  /** Degrees, counter-clockwise from the automatic grain orientation. */
  readonly rotation: number;
};

function materialOf(record: BuiltinVersionRecord): LibraryMaterial {
  const maps: { [role: string]: LibraryMap } = {};
  for (const role of record.roles) {
    maps[role] = {
      colourSpace: role === 'albedo' || role === 'albedoTint' ? 'srgb' : 'linear',
      ...(role === 'normal' && { convention: 'opengl' as const }),
      files: Object.fromEntries(record.sizes.map((size) => [size, `tex/${record.versionId}/${role}.${size}.webp`])),
    };
  }
  return { versionId: record.versionId, kind: record.kind, facts: record.facts, maps };
}

const materials = BUILTIN_RECORDS.versions.map((record) => materialOf(record));

function bindingOf(record: BuiltinFinishRecord): BuiltinBinding {
  const material = materials[record.version];
  if (material === undefined)
    throw new ViewerLibError('internal', `builtin-library: finish ${record.finish} names version ${record.version}, which is not listed`);
  return { material, rotation: record.rotation, ...(record.colour !== undefined && { colour: record.colour }) };
}

/** Every bound bundled room finish, by its catalogue id. */
export const BUILTIN_FINISHES: ReadonlyMap<string, BuiltinBinding> = new Map(
  BUILTIN_RECORDS.finishes.map((record) => [record.finish, bindingOf(record)]),
);

/** The ceiling every room wears when it names none; `null` while it keeps its flat paint. */
export const BUILTIN_DEFAULT_CEILING: BuiltinBinding | null = BUILTIN_RECORDS.ceiling === null ? null : bindingOf(BUILTIN_RECORDS.ceiling);
