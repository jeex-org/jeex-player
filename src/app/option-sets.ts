/**
 * The one closed option set that cannot live beside the union it belongs to.
 *
 * `OPTION_SCHEMA`'s five other sets (`VIEW_MODES`, `TOUR_MODES`,
 * `MOTION_MODES`, `INTERACTION_MODES`, `EDITS_MODES`) sit in
 * `viewer-options.ts`, next to the `ViewerOptions` field each one validates,
 * because they can. `SLOT_VALUES` cannot: its union is `SlotName`, declared in
 * `ui/host-slots.ts`, which touches the DOM — and `viewer-options.ts` is in
 * `src/purity.test.ts`'s `PURE_MODULES`, so only the TYPE may cross. The array
 * is therefore a literal COPY, and a copy needs its proof of completeness
 * beside it rather than in the middle of the contract file.
 *
 * Invariant: the copy is proven, never asserted. `satisfies readonly
 * SlotName[]` refuses a name the union does not have; `_MissingSlotName`
 * refuses a union member the copy does not list. Adding a slot to
 * `SLOT_NAMES` without adding it here does not compile.
 *
 * Pure module: no `three`, no DOM (the type edge is erased by
 * `verbatimModuleSyntax` and `purity.test.ts` does not count it).
 */

import type { SlotName } from '../ui/host-slots.js';

/** `SLOT_NAMES`, as a value this pure module may hold. */
export const SLOT_VALUES = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'modal-root',
  'selection-anchor',
] as const satisfies readonly SlotName[];

/** Exhaustiveness: fails to compile if `SLOT_VALUES` is missing a member of `SlotName`. */
type _MissingSlotName = Exclude<SlotName, (typeof SLOT_VALUES)[number]>;
((): _MissingSlotName extends never ? true : ['SLOT_VALUES missing', _MissingSlotName] => true)();

/**
 * A closed set, proved complete against its union at compile time:
 * `closedSet<Union>()(['a', 'b'] as const)` fails to compile when the list
 * misses a member of `Union`, and `satisfies`-style checking refuses a member
 * the union does not have. The sets of `viewer-options.ts` use it so each needs
 * one line rather than a type alias and a call of its own; it imports no type
 * from there, so no cycle appears.
 */
export function closedSet<Union extends string>() {
  return <const List extends readonly Union[]>(
    list: List & ([Exclude<Union, List[number]>] extends [never] ? unknown : ['missing', Exclude<Union, List[number]>]),
  ): List => list;
}
