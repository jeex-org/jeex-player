# Tasks

## 1. Red tests

- [x] 1.1 Room merge (`SceneModel.apply`):
  - two rooms merge into one revision;
  - three rooms merge in one batch, with the result independent of array order;
  - the survivor is the largest room, a tie going to the smaller id;
  - the survivor keeps its fields;
  - objects are rebound without moving;
  - painted faces are re-keyed;
  - the absorbed room's camera and room finishes are dropped;
  - preset instructions are forgotten and an emptied preset is dropped;
  - a room merges with a loggia;
  - detached rooms are excluded;
  - a room added into an occupied face still fails with `MULTI_ANCHOR`;
  - a moved anchor in a batch with `remove_wall` still fails with `MULTI_ANCHOR`;
  - `remove_wall` then `merge_wall` at its junction, in one batch, with both sides painted;
  - preset instructions in the explicit `set_material` form, and ones naming the removed wall, are forgotten;
  - a batch without `remove_wall` never merges;
  - a dangling or disconnected graph is still refused with the document and revision unchanged;
  - `roomMerges` and `touched` are reported.
- [x] 1.2 `merge_wall` applier:
  - a split is undone with the original id;
  - all four endpoint orientations;
  - opening centres;
  - an explicit hinge on a reversed wall;
  - an explicit swing on a reversed exterior wall (kept) and a reversed interior wall (flipped);
  - `merge_wall_swing_unresolved` on an unbuildable mid-batch graph;
  - preset instructions naming either wall are forgotten;
  - the merged wall takes the earlier index;
  - split then merge round-trips to an equal document, with `remap` in the outcome;
  - painted faces: left/right through a reversal, the primary is the longer ancestor, an unpainted primary;
  - the joint node is removed;
  - every refusal kind leaves the scene unchanged;
  - an invalid or duplicate id, and an `id` equal to one of `wallIds`.
- [x] 1.3 Schema: `merge_wall` parses; it is refused with a wrong tuple length, a malformed id or no `id`; a preset carrying it is refused.

## 2. Implementation

- [x] 2.1 `room-merge.ts` and the `SceneModel.apply` hook; the `roomMerges` result type
- [x] 2.2 `merge_wall`: the type, schema, dispatcher, applier and `CREATING_OPS`
- [x] 2.3 Public exports, README and CHANGELOG

## 3. Checks

- [ ] 3.1 Fast tier green
- [x] 3.2 OCR review of record and security review; one answer commit
- [ ] 3.3 One full gate
