/**
 * The closed sets of the scene schema, declared ONCE each, and the membership
 * test over them.
 *
 * A closed set has two halves: a string-literal UNION in `types.ts` that the
 * compiler reasons about, and a runtime LIST the validator checks a document
 * against. `as const satisfies readonly Union[]` binds them: the literal types
 * survive, a name here that is not in the union fails to compile, and a member
 * of the union that is missing here fails `closed-sets.test.ts`.
 *
 * Invariant: nothing else in the library declares a set of these values.
 * The library once declared four of them as `new Set<string>([...])` —
 * completely detached from the unions they guard, so adding `'skylight'` to
 * `OpeningType` compiled everywhere and was silently rejected by the validator
 * with "unknown type".
 *
 * Pure module: no `three`, no DOM.
 */

import type { OpeningHinge, OpeningShape, OpeningSwing, OpeningType, RoomKind, RoomPurpose, SiteSun, WallRole } from './types.js';

export const OPENING_TYPES = ['door', 'window', 'passage'] as const satisfies readonly OpeningType[];
export const ROOM_KINDS = ['room', 'loggia'] as const satisfies readonly RoomKind[];
export const ROOM_PURPOSES = [
  'living',
  'kitchen',
  'kitchen-living',
  'dining',
  'bedroom',
  'kids',
  'study',
  'bathroom',
  'wc',
  'hall',
  'corridor',
  'storage',
  'utility',
  'balcony',
] as const satisfies readonly RoomPurpose[];
export const WALL_ROLES = ['bearing', 'partition', 'facade'] as const satisfies readonly WallRole[];
export const OPENING_SHAPES = ['flat', 'arch'] as const satisfies readonly OpeningShape[];
export const OPENING_HINGES = ['a', 'b'] as const satisfies readonly OpeningHinge[];
export const OPENING_SWINGS = ['in', 'out'] as const satisfies readonly OpeningSwing[];
export const SITE_SUNS = ['morning', 'noon', 'evening'] as const satisfies readonly SiteSun[];

/** True when `value` is a member of the closed set `set`, narrowed to it. */
export function isMemberOf<T extends string>(set: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (set as readonly string[]).includes(value);
}

/** The membership test the schema needs most often, named for its reader. */
export function isOpeningType(value: unknown): value is OpeningType {
  return isMemberOf(OPENING_TYPES, value);
}
