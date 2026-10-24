# Spec Delta

## Purpose
The element metadata table that `exportGlb` writes as `EXT_structural_metadata`: one row per exportable element, how each row is identified or addressed, its columns, its order, and how meshes point back at their rows.

## ADDED Requirements

### Requirement: Rows of the element table

The export SHALL write one property table `jeexElements` of class `jeexElement` with exactly one row per wall, wall face, room, opening and furniture placement of the exported document.

#### Scenario: Row count
- **WHEN** a document with walls, openings, rooms, placements and solved wall faces is exported
- **THEN** the table's `count` equals walls + openings + rooms + placements + faces, and each wall face of the solved plan has exactly one `wallFace` row

### Requirement: Entity rows carry the entity's own UUID

A row for a wall, opening, room or furniture placement SHALL carry the entity's own UUID from the document as `id` and `guid`, and its IFC 22-character compression as `ifcGuid`. The export SHALL NOT derive, hash or mint any id.

#### Scenario: Entity identity
- **WHEN** a document is exported
- **THEN** every non-face row has `guid` equal to `id`, `id` is a UUID the document holds for that entity, and `ifcGuid` is the IFC compression of that UUID

### Requirement: Wall-face rows are addressed structurally

A `wallFace` row SHALL have no id of its own: its `guid`, `ifcGuid` and `id` cells SHALL be `null`, and the three properties SHALL be declared `required: false`. The row SHALL be addressed by `wallId` (the wall's UUID) and `side` (`L` or `R`); every side of a wall bounds exactly one face of the solved plan, so no two face rows SHALL share the same `wallId` and `side`. `roomId` SHALL name the room the face is seen from, and SHALL be `null` for a facade face.

#### Scenario: Room face
- **WHEN** a wall face seen from a room is exported
- **THEN** its row has `class: "wallFace"`, `guid`, `ifcGuid` and `id` `null`, `wallId` the wall's UUID, `side` the wall side, `roomId` the room's UUID, and `finish` the painted finish when one is set

#### Scenario: Facade face
- **WHEN** an exterior wall is exported, its inner side facing a room and its outer side facing outside
- **THEN** the outer side's row has that wall's `wallId`, the outer `side` and `roomId` `null`, and the inner side's row has the same `wallId`, the other `side` and the room's UUID

### Requirement: Deterministic row order

Rows SHALL be ordered by class (wall, wall face, opening, furniture, room); entity rows within a class by `id`; face rows by `wallId`, then `side`, by ordinal string comparison. The order SHALL NOT depend on the order the document lists its nodes, walls or rooms.

#### Scenario: Re-export
- **WHEN** the same document is exported twice
- **THEN** the two GLBs are byte-for-byte identical

#### Scenario: Face order
- **WHEN** the face rows of an export are read in order
- **THEN** their `(wallId, side)` pairs are strictly increasing

### Requirement: Meshes point at their rows

Every exported wall mesh SHALL point at its face row through an `EXT_mesh_features` feature id holding the row index, at the row whose `wallId`, `side` and `roomId` match the face the mesh was built for. Every exported node that carries an opening's or a furniture placement's reference (an opening mesh, a placement's group) SHALL point at that entity's row the same way.

#### Scenario: Face mesh to row
- **WHEN** the wall meshes of an export are read
- **THEN** there is one per face row, each carries a feature id, and following it gives a `wallFace` row with the mesh's wall, side and room whose id cells are `null`
