/**
 * What `strict-new` counts as the SAME hard issue across a batch that renamed
 * the walls or rooms it names.
 *
 * An issue is keyed by its rule and its sorted entity ids. A batch can give an
 * entity a new id without moving anything: `split_wall` hands a wall to two
 * halves, `merge_wall` hands two walls to the one that joins them, and a room
 * merge hands the absorbed room to the survivor (`room-merge.ts`). A sofa that
 * already stood in the old wall then reports against the new id, a key the
 * base never had. So the base's keys are carried forward through those heirs
 * before they are compared: the issue is old under every id its entities
 * became. An issue the batch really creates (a piece pushed into the new wall)
 * has no base issue to inherit, and stays new.
 *
 * Pure module: no `three`, no DOM.
 */

import { circulationSentenceOf, type LayoutIssue } from '../layout/layout-issue.js';
import type { RoomMerge } from './room-merge.js';
import type { SceneOp } from './types.js';

/** An issue by WHAT it says about WHOM: its rule and its sorted entity ids (`free-space.ts` keys the same way). */
export function issueKey(issue: Pick<LayoutIssue, 'rule' | 'ids'>): string {
  return `${issue.rule}|${[...issue.ids].sort().join(',')}`;
}

/**
 * For every id the batch replaced, the ids it stands under at the end of the
 * batch, followed in op order so a split half that is merged again lands on
 * the merged wall. Ids the batch never replaced are absent.
 */
export function heirsOf(ops: readonly SceneOp[], roomMerges: readonly RoomMerge[]): ReadonlyMap<string, ReadonlySet<string>> {
  const heirs = new Map<string, Set<string>>();
  const replace = (gone: string, by: readonly string[]): void => {
    for (const now of heirs.values()) {
      if (!now.delete(gone)) continue;
      for (const id of by) now.add(id);
    }
    if (!heirs.has(gone)) heirs.set(gone, new Set(by));
  };
  for (const op of ops) {
    if (op.op === 'split_wall') replace(op.wallId, op.ids);
    else if (op.op === 'merge_wall') for (const wallId of op.wallIds) replace(wallId, [op.id]);
  }
  // Room merges run at commit, after every op.
  for (const merge of roomMerges) replace(merge.from, [merge.to]);
  return heirs;
}

/** The keys of `issues`, each also under every combination of the ids its entities became. */
export function inheritedKeys(
  issues: readonly Pick<LayoutIssue, 'rule' | 'ids'>[],
  heirs: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const keys = new Set<string>();
  for (const issue of issues) {
    let combinations: string[][] = [[]];
    for (const id of issue.ids) {
      const now = heirs.get(id);
      const names = now ? [...now] : [id];
      combinations = combinations.flatMap((prefix) => names.map((name) => [...prefix, name]));
    }
    for (const ids of combinations) keys.add(issueKey({ rule: issue.rule, ids }));
  }
  return keys;
}

/**
 * Whether a `circulation` error in a room merge's survivor is a blockage the
 * merged rooms already had, under another wording.
 *
 * The rule's sentences depend on the room's shape: furniture that left a door
 * with no free floor in the absorbed room can, once the walls are gone, leave
 * it with floor but no path, or leave the main zone out of reach. So the
 * error counts as inherited when it names at least one opening (`openingIds`)
 * and EVERY opening it names already had a `circulation` error, of any
 * wording, in the survivor or a room merged into it. One opening that was
 * clear before makes it new.
 */
export function inheritedCirculation(
  issue: Pick<LayoutIssue, 'rule' | 'ids'>,
  base: readonly Pick<LayoutIssue, 'rule' | 'ids'>[],
  roomMerges: readonly RoomMerge[],
  openingIds: ReadonlySet<string>,
): boolean {
  if (issue.rule !== 'circulation') return false;
  const survivor = issue.ids.find((id) => roomMerges.some((merge) => merge.to === id));
  if (survivor === undefined) return false;
  const merged = new Set([survivor, ...roomMerges.filter((merge) => merge.to === survivor).map((merge) => merge.from)]);
  const openings = issue.ids.filter((id) => openingIds.has(id));
  if (openings.length === 0) return false;
  return openings.every((opening) =>
    base.some((old) => old.rule === 'circulation' && old.ids.includes(opening) && old.ids.some((id) => merged.has(id))),
  );
}

/** The operations that can change where furniture stands or how much floor it takes. */
const PLACEMENT_OPS: ReadonlySet<SceneOp['op']> = new Set([
  'place_object',
  'move_object',
  'rotate_object',
  'set_object',
  'remove_object',
  'mirror_object',
  'replace_asset',
  'replace_asset_variant',
]);

/** Two report points closer than this are the same door side, metres. */
const SAME_POINT_M = 0.01;

/**
 * Whether a «no path from A to B» error in a room merge's survivor is a door
 * that was already boxed in, now reported in other words.
 *
 * Removing a wall can give a door boxed in by furniture a sliver of floor, and
 * the same furniture then reports as a path that cannot reach it. Rule 6
 * reports a path error at the TARGET door's approach point, which the door
 * alone fixes, wherever the path actually breaks. So the point alone cannot
 * tell an old blockage from a new one, and the rule is kept narrow on purpose:
 *
 * - the batch moves no furniture (`PLACEMENT_OPS`): then the only things that
 *   can block the path are pieces that already stood there;
 * - one of the two doors it names had «no free floor in front of it» in one of
 *   the merged rooms before, at that same approach point (`SAME_POINT_M`).
 *
 * Any other earlier circulation error on a door does not excuse a path, and
 * neither does an edit that moves, places, swaps or removes furniture. Do not
 * widen it without a case that needs it.
 */
export function inheritedPath(
  issue: Pick<LayoutIssue, 'rule' | 'ids' | 'message' | 'at'>,
  base: readonly Pick<LayoutIssue, 'rule' | 'ids' | 'message' | 'at'>[],
  roomMerges: readonly RoomMerge[],
  ops: readonly SceneOp[],
): boolean {
  if (circulationSentenceOf(issue) !== 'no-path') return false;
  if (ops.some((op) => PLACEMENT_OPS.has(op.op))) return false;
  const survivor = issue.ids.find((id) => roomMerges.some((merge) => merge.to === id));
  if (survivor === undefined) return false;
  const merged = new Set([survivor, ...roomMerges.filter((merge) => merge.to === survivor).map((merge) => merge.from)]);
  const at = issue.at;
  const doors = issue.ids.filter((id) => id !== survivor);
  return base.some(
    (old) =>
      circulationSentenceOf(old) === 'no-floor' &&
      doors.includes(old.ids[0]!) &&
      old.ids.some((id) => merged.has(id)) &&
      Math.hypot(old.at.x - at.x, old.at.z - at.z) <= SAME_POINT_M,
  );
}
