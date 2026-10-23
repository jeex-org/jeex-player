/**
 * Carries `finishes.faces` across a topology change.
 *
 * A wall operation moves the paintable faces: a split turns one face into two,
 * a merge turns two into one, a deletion removes one. The painted finishes are
 * listed by `FaceKey`, so unless something carries them the paint silently
 * disappears — and the failure looks like a rendering bug rather than like a
 * missing migration. This module is the ONE place that decides what happens,
 * so every future operation gets the same answer.
 *
 * The policy, in one line each:
 * - `split`    — every heir inherits the ancestor's finish; a split wall stays
 *                one colour, which is what the person who painted it meant.
 * - `merged`   — the survivor keeps the finish of the ancestor named
 *                `primary`; the others are lost, because one face can hold
 *                one finish and guessing a blend would invent data.
 * - `deleted`  — the finish goes with the face.
 * - `unchanged`— copied under the faces the entry names.
 * - faces the remap never mentions are carried over untouched, and `created`
 *   faces inherit nothing.
 *
 * Invariant: pure and non-mutating — the input list is read, never written,
 * and the result is a fresh list in a deterministic order: every entry keeps
 * its place, an ancestor's place taken by its heirs in the order the remap
 * lists them. A face appears in the result at most once; when an heir is
 * also painted in its own right, the remap's answer wins, because the edit is
 * what decided that face's fate.
 *
 * Pure module: no `three`, no DOM.
 */

import { FaceMap, faceKey, sameFace, type FaceFinish, type FaceKey, type FinishRef, type TopologyRemap } from './types.js';

/** The bare key of a painted entry, without its `finish`. */
function keyOf(face: FaceKey): FaceKey {
  return faceKey(face.room ?? null, face.wallId, face.side);
}

/**
 * `faces` after `remap`: the same finishes under the faces the edit gave them.
 *
 * A finish value travels by reference, whichever spelling it has: it is
 * immutable data, so an heir wears the very object its ancestor wore and a
 * colour or a rotation can never be lost on the way.
 *
 * The result is a plain list of fresh entries, so it drops straight into a
 * `SceneFinishes.faces` field.
 */
export function remapFaceFinishes(faces: readonly FaceFinish[], remap: TopologyRemap): FaceFinish[] {
  // The finish each heir inherits, decided once from the remap alone.
  const finishOf = new FaceMap<FinishRef>();
  for (const entry of faces) finishOf.set(keyOf(entry), entry.finish);
  const heirsOf = new FaceMap<FaceKey[]>();
  const inherited = new FaceMap<FinishRef>();
  for (const entry of remap.faces) {
    heirsOf.set(entry.from, [...entry.to]);
    const finish = finishOf.get(entry.from);
    if (finish === undefined || entry.status === 'deleted') continue;
    // A merge is several entries pointing at one survivor: only the ancestor
    // the remap named as primary hands its finish over.
    if (entry.status === 'merged' && (entry.primary === undefined || !sameFace(entry.primary, entry.from))) continue;
    for (const heir of entry.to) inherited.set(heir, finish);
  }

  const out = new FaceMap<FinishRef>();
  for (const entry of faces) {
    const face = keyOf(entry);
    const heirs = heirsOf.get(face);
    if (heirs === undefined) {
      // Unmentioned: carried over, unless the remap hands this face a finish of its own.
      if (!inherited.has(face)) out.set(face, entry.finish);
      continue;
    }
    for (const heir of heirs) {
      const finish = inherited.get(heir);
      if (finish !== undefined && !out.has(heir)) out.set(heir, finish);
    }
  }
  return [...out].map(([face, finish]) => ({ ...face, finish }));
}
