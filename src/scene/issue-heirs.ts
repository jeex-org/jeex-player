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

import type { LayoutIssue } from '../layout/layout-issue.js';
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
