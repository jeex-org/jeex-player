# Proposal

## Why

Removing the only wall between two rooms refuses the whole batch with `MULTI_ANCHOR`, because the final plan has one face holding two room anchors. To a person editing the plan, or to an assistant asked to open up the kitchen, this looks like a bug. There is also no inverse of `split_wall`: two collinear walls cannot be joined back into one.

## What Changes

- When a batch removes walls and the final plan holds several anchors of pre-existing rooms in one face, the rooms merge at commit instead of failing. The largest room by floor area survives; a tie goes to the smallest id. The survivor keeps its id, name, kind, purpose, accent, floor, room finishes and camera. Absorbed rooms' objects and painted wall faces move to it. Their cameras, room finishes and preset instructions are dropped.
- `ApplyOk` reports the merges as `roomMerges: { from, to, summary }[]`.
- New scene op `merge_wall { wallIds: [first, second], id }`. It joins two straight, collinear walls of the same thickness and role that meet at a node no other wall uses, into one wall with a caller-minted id. It carries openings and painted faces, and removes the joint node.

## Capabilities

### New Capabilities

- `room-merge`: when rooms merge on wall removal, which room survives, what moves to it and what is dropped, and how the merge is reported.
- `merge-wall-op`: what `merge_wall` produces, carries and refuses.

### Modified Capabilities

None.

## Impact

- Code: the scene model's commit path and a new pure room-merge module; scene op types, the schema, the dispatcher, the shell ops and preset validation; public exports in `jeex-viewer/ops`; README and CHANGELOG.
- Public API: a new op, and a new optional `roomMerges` field on the apply result. The scene schema version is unchanged.
- Hosts that commit through `SceneModel.apply` get the merge without changes. An editor host's translator may start emitting `merge_wall`.
