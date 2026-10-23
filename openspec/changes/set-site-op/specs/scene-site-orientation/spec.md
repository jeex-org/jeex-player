## ADDED Requirements

### Requirement: Set site operation

The scene operation `set_site` SHALL take optional `northDeg` (finite number or `null`) and `sun` (`morning`, `noon`, `evening` or `null`), at least one present. A present value sets the field, `null` clears it, an omitted key keeps it; `northDeg` is stored normalised to [0, 360). When both fields end absent, `site` SHALL be removed. It SHALL be refused on a 2.2 document by the applier itself and SHALL NOT change `schemaVersion`.

#### Scenario: Set both
- **WHEN** `set_site` with `northDeg: -90, sun: "evening"` is applied to a 2.3 document without `site`
- **THEN** the document has `site: { northDeg: 270, sun: "evening" }`

#### Scenario: Clear one
- **WHEN** `set_site` with `sun: null` is applied to a document with `site: { northDeg: 30, sun: "noon" }`
- **THEN** the document has `site: { northDeg: 30 }`

#### Scenario: Clear both removes site
- **WHEN** `set_site` with `northDeg: null, sun: null` is applied
- **THEN** the document has no `site`

#### Scenario: Empty operation
- **WHEN** `set_site` carries neither key
- **THEN** it is refused as an invalid operation and the document is unchanged

#### Scenario: Bad values
- **WHEN** `set_site` carries `northDeg` as NaN, infinity or a string, or `sun` as `"night"`
- **THEN** it is refused naming the field and the document is unchanged

#### Scenario: 2.2 document
- **WHEN** `set_site` is applied to a 2.2 document
- **THEN** it is refused naming the schema version and the document is unchanged

#### Scenario: Live viewer
- **WHEN** a live viewer applies `set_site` with `sun: "morning"` through `applyOps`
- **THEN** the sun shines from the morning preset and its shadow is refitted, without a reload, and a second `set_site` with the previous values restores the previous sun

### Requirement: Set site reporting and scope

A change of `site`, by `set_site` or by replacing the document, SHALL report the touched kind `site`. `set_site` SHALL NOT be allowed inside interior presets.

#### Scenario: Touched and diff
- **WHEN** `set_site` changes the orientation, or `replaceDocument` replaces a document whose `site` differs
- **THEN** the change reports the touched kind `site`

#### Scenario: Not in presets
- **WHEN** an interior preset carries a `set_site` operation
- **THEN** the document is invalid naming the preset and the operation
