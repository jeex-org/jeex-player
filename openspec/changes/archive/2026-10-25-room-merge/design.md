# Design

## Context

`SceneModel.apply` applies a batch to a draft op by op, then validates and solves the draft. `assignRooms` refuses a face with more than one attached anchor (`MULTI_ANCHOR`). `split_wall` cuts a wall into two caller-minted halves and carries painted faces through `remapFaceFinishes`. The brainstorm settled where the merge runs and which room survives.

## Goals / Non-Goals

Goals:
- Rooms merge at commit, deterministically.
- A written survivor rule.
- `merge_wall` as the inverse of `split_wall`.
- One revision per batch.

Non-goals:
- A UI for wall editing.
- Carrying per-op topology remaps or structured refusal details through `ApplyOk` / `ApplyFailure`.
- Merging arc walls.
- Room merges for a document replaced as a whole (`replaceDocument`).

## Decisions

### Where the merge runs

A pure module `src/scene/room-merge.ts` exports:
- `planRoomMerges(base, basePlan, draft)`, which returns the merge groups;
- `applyRoomMerges(draft, groups)`, which writes them and returns the report and the touched entities.

`SceneModel.apply` calls them after the op loop and before `validateScene`, only when the batch contains `remove_wall`.

`planRoomMerges` builds the draft's graph with `buildGraph`. Any throw is left for validation to report as it does today. It then groups the attached anchors per face, using an `anchorsPerFace` helper extracted from `assignRooms` so the two cannot drift. A group with two or more rooms is merged only when every room in it is an attached room of `base` with the same anchor; any other group is left as it is and fails as `MULTI_ANCHOR`.

### Survivor and absorption

- Area: `Math.abs(signedArea(polygon))` of the room's inner polygon in the committed solved plan. This is the measure `door-swing.ts` already uses.
- Order: the largest area wins; a tie goes to the smaller id by string comparison.
- Absorption follows the brainstorm's list. Faces are re-keyed by rewriting the `room` of `finishes.faces` entries. Two valid rooms never own the same physical face, and the merged wall's faces already carry one owner (see below), so a duplicate can only come from a hand-made document. The guard keeps the survivor's own entry.

Presets are cleaned with `forgetInPresets`. The predicate matches every instruction naming the absorbed room:
- `target` naming it as a room, floor or walls target;
- the explicit form's `room`;
- `face.room`;
- `room` / `roomId` fields of the other preset-legal ops.

The shared `namesRoom` helper is extended to the explicit form, which also fixes `remove_room`.

### Reporting

`ApplyOk.roomMerges` is present only when non-empty. Its summaries are built from the names in the draft before absorption.

### merge_wall

- Applier: `applyMergeWall` in `ops/shell.ts`. If the 700-line limit is reached, the merge refusals and the frame mapping move to `ops/wall-merge.ts`.
- Collinearity: the distance of the joint from the outer segment must be ≤ `EPS_PLANAR`, and the joint's projection must lie strictly inside the segment.
- Openings: centre = distance from the merged wall's start to the projected world centre.
- Hinge `a`/`b`: flips when the source wall's `a` is not on the merged wall's start side.
- Swing:
  - `'in'` means the room side when one side of the wall is the facade, and the left of a→b when both sides are rooms (`door-swing.ts`).
  - The two collinear source walls at a degree-2 joint share the same two faces, so the merged wall has the same facade status.
  - The applier builds `buildGraph(draft.nodes, draft.walls)`. An explicit swing on a reversed source wall is kept when the wall has a facade side, and flipped when both sides are rooms.
  - When the graph cannot be built mid-batch and a reversed wall carries an explicit swing, the op is refused with `merge_wall_swing_unresolved`. Failure mode: a batch that merges walls while its plan is transiently open. Likelihood: low (merges follow removals, not open boundaries). Cost: one refusal branch. In every other case the graph is not needed.
- Faces: per side, the painted ancestor faces map to ONE heir key, owned by the primary ancestor's owner, with status `merged`. Left/right are mapped through the direction. This covers `remove_wall` then `merge_wall` in one batch, where the two ancestors on one side carry different room owners; the commit-time merge then renames that owner to the survivor.
- Presets: instructions naming either source wall (face targets, `set_wall`, `set_opening` with the `wallId`) are forgotten, as the room rule does. `remove_wall` likewise forgets instructions naming the removed wall (today it forgets only openings), because a preset painting the removed partition would otherwise refuse the headline batch.
- Order: the merged wall takes the earlier index of the two in `walls`. Openings are listed in the order of their new centres, so `split_wall` then `merge_wall` gives an equal document.
- The outcome carries the face `remap`, as `split_wall` does, and lists the old and new face keys in `touched`.

### Refusal kinds

`MergeRefusal` is the union of:
- `merge_wall_same_wall`;
- `merge_wall_unknown_wall`;
- `merge_wall_not_adjacent`;
- `merge_wall_junction`;
- `merge_wall_not_collinear`;
- `merge_wall_not_between`;
- `merge_wall_arc_unsupported`;
- `merge_wall_mismatch` (with `field`: `thickness` or `role`);
- `merge_wall_swing_unresolved`.

The kind travels on `OpError.detail.kind`, as `SplitRefusal` does. An invalid or reused `id` is `requireNewId`'s `invalid_id` / `duplicate_id`; an `id` equal to one of `wallIds` is `duplicate_id`.

### Schema and exports

- `MergeWallOp` joins the op union, the Zod schema (exact tuple of two UUIDs plus an `id` UUID), `CREATING_OPS`, `applyOp` and `jeex-viewer/ops`.
- No scene version bump.
- `MergeWallOp` and its schema sit beside `SplitWallOp` in `types.ts` / `types.schema.ts`, which have their own schema line limit in `size-check.ts`.

## Risks / Trade-offs

- Commit-time merging changes `SceneModel.apply` for every host. It is limited to batches with `remove_wall` and to anchors that pre-existed, so every other batch is unchanged.
- A room merged with a loggia takes the survivor's kind, so a large loggia could absorb a small room as a loggia. This is accepted; the summary names it and the caller can `set_room` afterwards.
- Swing mapping is the subtle part; it is pinned by its own tests (a reversed exterior wall, a reversed interior wall).
- Implicit door defaults are re-derived, as after any plan edit today. An omitted swing opens into the larger room and an omitted hinge depends on the gaps to the wall ends. A merge can therefore move an untouched door's implicit side or jamb, exactly as moving a node can. Explicit values are carried; implicit ones are not frozen.
- A tie in area is decided by id; the tie tests use exactly representable equal areas.
