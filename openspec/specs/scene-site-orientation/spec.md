# scene-site-orientation Specification

## Purpose
The scene document's optional orientation: where true north lies on the plan and which sun preset lights it, with validation and defaults.

## Requirements

### Requirement: Site orientation field

A scene document of schema version 2.3 MAY carry `site`, an object with an optional `northDeg` (finite number of degrees, the world azimuth of true north clockwise from +Z towards +X, read modulo 360) and an optional `sun` (`morning`, `noon` or `evening`). Version 2.2 documents SHALL stay readable and SHALL NOT carry `site`. Any other key inside `site`, a non-finite `northDeg` or another `sun` value SHALL make the document invalid with a message that names the field.

#### Scenario: Valid site
- **WHEN** a 2.3 document carries `site: { northDeg: 30, sun: "evening" }`
- **THEN** it validates and the player orients the sun by it

#### Scenario: Unknown key
- **WHEN** a 2.3 document carries `site: { north_deg: 30 }`
- **THEN** validation fails naming `site.north_deg`

#### Scenario: Bad values
- **WHEN** a 2.3 document carries `site.northDeg` as `NaN`, a string or infinity, or `site.sun` as `"night"`
- **THEN** validation fails naming the field

#### Scenario: Site in a 2.2 document
- **WHEN** a 2.2 document carries `site`
- **THEN** validation fails naming `site` and the version

#### Scenario: Site not an object
- **WHEN** a 2.3 document carries `site` as `null`, an array or a number
- **THEN** validation fails naming `site`

#### Scenario: 2.2 unchanged
- **WHEN** a valid 2.2 document without `site` is loaded
- **THEN** it validates as before and the sun keeps the legacy direction

### Requirement: Orientation defaults

With no `site` the sun SHALL keep the legacy direction. With a `site`, a missing `northDeg` SHALL read as 0 and a missing `sun` as `noon`.

#### Scenario: Empty site
- **WHEN** a 2.3 document carries `site: {}`
- **THEN** the sun is the `noon` preset with north along +Z

### Requirement: Published JSON Schema

The JSON Schema the package publishes for scene documents SHALL describe `site` exactly as the validator judges it.

#### Scenario: Generated schema agrees
- **WHEN** the JSON Schema is generated
- **THEN** it accepts the valid and rejects the invalid examples of this capability, including a 2.2 document with `site`

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
