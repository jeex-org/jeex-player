# merge-wall-op Specification

## Purpose
`merge_wall` joins two collinear straight walls meeting at a node no other wall uses into one wall with a caller-minted id, carrying openings and paint; the inverse of `split_wall`.

## Requirements

### Requirement: merge_wall joins two collinear walls

`merge_wall { wallIds: [first, second], id }` SHALL replace the two walls by one wall with the caller-minted `id`, running from `first`'s outer node through the joint to `second`'s outer node, with their thickness and role, and SHALL remove the joint node. It SHALL NOT mint an id; a freed id MAY be reused.

#### Scenario: Split undone
- **WHEN** a wall split into two halves is merged with its original id and the halves in order
- **THEN** the plan has the original wall id, direction and length again, and no joint node

### Requirement: merge_wall carries openings and paint

Openings SHALL keep their ids and dimensions with centres re-projected into the merged wall's frame; an explicit hinge or swing SHALL keep its physical jamb and side when a source wall ran the other way. Per side, painted faces SHALL map to one face owned by the primary (longer, tie `wallIds[0]`) ancestor's owner, by the `merged` policy.

#### Scenario: Unpainted primary
- **WHEN** only the shorter wall's face is painted
- **THEN** the merged face carries no override, by the `merged` policy

#### Scenario: Reversed interior and exterior walls
- **WHEN** a reversed source wall carries a door with an explicit swing
- **THEN** on an exterior wall the swing is kept, and on a wall with rooms on both sides it is flipped, so the leaf opens to the same physical side

#### Scenario: Reversed second wall
- **WHEN** the second wall runs towards the joint and carries a door with an explicit hinge
- **THEN** the door stands at the same place on the merged wall, hinged on the same physical jamb

### Requirement: merge_wall refusals

`merge_wall` SHALL be refused, scene unchanged, with a stable `detail.kind` (`merge_wall_same_wall`, `_unknown_wall`, `_not_adjacent`, `_junction`, `_not_collinear`, `_not_between`, `_arc_unsupported`, `_mismatch`, `_swing_unresolved`) on the matching fault; `id` SHALL pass `requireNewId`. Preset instructions naming either wall SHALL be forgotten.

#### Scenario: T-junction
- **WHEN** a third wall meets the shared node
- **THEN** the op is refused with kind `merge_wall_junction`

#### Scenario: Id of a source wall
- **WHEN** `id` equals one of `wallIds`
- **THEN** the op is refused with `duplicate_id`

#### Scenario: Corner
- **WHEN** the two walls meet at a right angle
- **THEN** the op is refused with kind `merge_wall_not_collinear`
