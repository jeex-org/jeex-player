## MODIFIED Requirements

### Requirement: Rows of the element table

When the exported document has at least one wall, wall face, room, opening or furniture placement, the export SHALL write one property table `jeexElements` of class `jeexElement` with exactly one row per wall, wall face, room, opening and furniture placement of the exported document. A document with none of them SHALL be exported with the schema and no property table.

#### Scenario: Row count
- **WHEN** a document with walls, openings, rooms, placements and solved wall faces is exported
- **THEN** the table's `count` equals walls + openings + rooms + placements + faces, and each wall face of the solved plan has exactly one `wallFace` row

#### Scenario: Empty document
- **WHEN** a document with no element is exported
- **THEN** `EXT_structural_metadata` carries the schema and no `propertyTables`

### Requirement: Wall-face rows are addressed structurally

A `wallFace` row SHALL have no id of its own: its `guid`, `ifcGuid` and `id` cells SHALL hold the properties' `noData` value (the empty string), and the three properties SHALL be declared `required: false`. The row SHALL be addressed by `wallId` and `side` (`L` or `R`); no two face rows SHALL share both, since each side of a wall bounds exactly one face of the solved plan. `roomId` SHALL name the room the face is seen from, and SHALL hold `noData` for a facade face.

#### Scenario: Room face
- **WHEN** a wall face seen from a room is exported
- **THEN** its row has `class: "wallFace"`, `guid`, `ifcGuid` and `id` at `noData`, `wallId` the wall's UUID, `side` the wall side, `roomId` the room's UUID, and `finish` the painted finish when one is set

#### Scenario: Facade face
- **WHEN** an exterior wall is exported, its inner side facing a room and its outer side facing outside
- **THEN** the outer side's row has that wall's `wallId`, the outer `side` and `roomId` at `noData`, and the inner side's row has the same `wallId`, the other `side` and the room's UUID

### Requirement: Meshes point at their rows

Every primitive of an element's mesh SHALL carry `EXT_mesh_features` with one feature id set `{ featureCount: 1, attribute: 0, propertyTable: 0 }` and a `_FEATURE_ID_0` `FLOAT` attribute holding that element's row index on every vertex. A mesh belongs to the element named by the nearest node at or above it that names one (wall face, room floor or ceiling, opening group, furniture placement group). `wall` rows SHALL carry no primitive, and only primitives SHALL carry the extension.

#### Scenario: Face mesh to row
- **WHEN** the wall meshes of an export are read
- **THEN** there is one per face row, each primitive's `_FEATURE_ID_0` holds one row index, and that row is a `wallFace` row with the mesh's wall, side and room whose id cells are `noData`

#### Scenario: Every element primitive resolves
- **WHEN** the demo apartment is exported
- **THEN** every primitive of every wall-face, floor, ceiling, opening and furniture mesh resolves to the row of its element, and every row other than a `wall` row is reached by at least one primitive

### Requirement: Deterministic row order

Rows SHALL be ordered by class (wall, wall face, opening, furniture, room); entity rows within a class by `id`; face rows by `wallId`, then `side`, by ordinal string comparison. The order SHALL NOT depend on the order the document lists its nodes, walls or rooms.

#### Scenario: Re-export
- **WHEN** the same document is exported twice
- **THEN** the two GLBs are byte-for-byte identical, the binary property table and the feature attributes included

#### Scenario: Face order
- **WHEN** the face rows of an export are read in order
- **THEN** their `(wallId, side)` pairs are strictly increasing

## ADDED Requirements

### Requirement: Binary property table

The `jeexElements` property table SHALL store every property of class `jeexElement` as a `STRING` property with a `values` bufferView of UTF-8 bytes and a `stringOffsets` bufferView of `count + 1` `UINT32` offsets, each bufferView starting on an 8-byte boundary of the binary chunk. The table SHALL NOT hold inline JSON arrays or `null` cells.

#### Scenario: A conformant reader reads the table
- **WHEN** the demo apartment is exported and the table is read by the extension's rules
- **THEN** every written property decodes from its bufferViews, each `stringOffsets` holds exactly `count + 1` aligned offsets whose last equals its `values` byte length, every left-out property is optional, and the decoded rows equal the element rows with each `noData` cell read as absent


### Requirement: Empty columns

The class SHALL declare all twelve properties; the table SHALL write every property that has a value in at least one row and SHALL leave out an optional property that has none.

#### Scenario: Empty column left out
- **WHEN** no row of the exported document has a `libraryId`
- **THEN** the class still declares `libraryId` and the table has no `libraryId` property

### Requirement: Missing values and schema version

`class` SHALL be `required: true` with no `noData`; every other property SHALL be `required: false` with `noData: ""`, and a row without that value SHALL hold the empty string. The schema SHALL carry `version: "2"`.

#### Scenario: Missing cells
- **WHEN** a wall-face row, which has no `id`, is written
- **THEN** its `id` cell is the empty string and the class declares `noData: ""` on `id` and nothing on `class`

### Requirement: GLB conformance

The exported GLB SHALL have its JSON and BIN chunks padded to a multiple of 8 bytes. The Khronos glTF Validator SHALL report no error on it; every warning and information it reports SHALL be one judged harmless for this export, and the only extensions it reports as unsupported SHALL be `EXT_materials_bump`, `EXT_mesh_features` and `EXT_structural_metadata`. A strict reader of `EXT_mesh_features` and `EXT_structural_metadata`, written from the extension text, SHALL report no finding.

#### Scenario: Demo apartment
- **WHEN** the demo apartment is exported with default options
- **THEN** the validator reports zero errors and only judged warnings and infos, both chunks are 8-byte padded, and the strict reader reports nothing
