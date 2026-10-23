/**
 * The two runtime questions about a finish value (`FinishRef`, `types.ts`):
 * which material it names, and whether its shape is one a document may carry.
 *
 * Kept out of `types.ts`, which declares the document and branches on
 * nothing; both answers are read by the validator, by `set_material` and by
 * the renderer, all of which sit in or above the scene layer.
 *
 * Pure module: no `three`, no DOM.
 */

import { isHexColour, isUuidV7, type FinishRef } from './types.js';

/** The material UUID a finish value names, whichever spelling it has. */
export function finishMaterialOf(ref: FinishRef): string {
  return typeof ref === 'string' ? ref : ref.material;
}

/** The keys a `FinishObject` may carry. */
const FINISH_OBJECT_KEYS: ReadonlySet<string> = new Set(['material', 'colour', 'rotation']);

/**
 * What is wrong with the SHAPE of a finish value, or `null` when nothing is:
 * a string (which material it names is the registries' question), or a strict
 * `FinishObject` with a UUID v7 `material`, a `#rrggbb` `colour`, a finite
 * `rotation` and at least one of the two.
 *
 * The one runtime shape check of a finish, run by the scene validator at every
 * finish location and by the explicit `set_material`, so neither depends on
 * the published schema, which the load path does not run.
 */
export function finishRefProblem(value: unknown): string | null {
  if (typeof value === 'string') return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return 'must be a finish UUID or { material, colour?, rotation? }';
  const unknown = Object.keys(value).find((key) => !FINISH_OBJECT_KEYS.has(key));
  if (unknown !== undefined) return `has unknown key ${JSON.stringify(unknown)}`;
  const { material, colour, rotation } = value as { material?: unknown; colour?: unknown; rotation?: unknown };
  if (!isUuidV7(material)) return 'material must be a UUID v7';
  if (colour !== undefined && !isHexColour(colour)) return 'colour must be a #rrggbb colour';
  if (rotation !== undefined && (typeof rotation !== 'number' || !Number.isFinite(rotation))) {
    return 'rotation must be a finite number of degrees';
  }
  if (colour === undefined && rotation === undefined) return 'needs colour or rotation; use the bare UUID';
  return null;
}
