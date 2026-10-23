# project-materials Specification

## Purpose
Defines the `library` member of a project manifest material: the wire shape a catalogue bake writes and an editor host packs, and every rule the viewer checks before it fetches anything from it.

## Requirements

### Requirement: Library member shape

A project material SHALL be exactly one of `pbr`, `generator` or `library` beside the common head `{ id, name, tags?, apply, preview? }`. The `library` member SHALL be `{ versionId, kind, facts, maps }` with `versionId` a lowercase UUID v7 and `kind` one of `scan` or `parameters`. Every object in it SHALL be strict, so an unknown key refuses the manifest.

#### Scenario: Well-formed scan accepted unchanged
- **WHEN** a manifest with a valid scan library material is parsed
- **THEN** it is accepted and the returned object is the very object given

#### Scenario: Unknown key refused
- **WHEN** a library material carries a key the shape does not name, at any depth
- **THEN** the manifest is refused with `project-invalid` and the issue path names that key

#### Scenario: Version id not a UUID v7
- **WHEN** `versionId` is a UUID v4 or an uppercase UUID v7
- **THEN** the manifest is refused

### Requirement: Validation judges and never transforms

Validation of the `library` member SHALL add no defaults and change no value; defaults that the contract names (metalness 0, roughness 1, alpha mode `opaque`, normal strength 1) apply when drawing, never in the parsed manifest.

#### Scenario: Absent defaults stay absent
- **WHEN** a library material without `pbr.metalness` and without `normalStrength` is parsed
- **THEN** the parsed material still has neither field

### Requirement: Surface words

The `apply` list of every project material SHALL accept the words `floor`, `wall`, `ceiling`, `facade`, `trim`, `furniture`, `fabric`, `metal`, `glass` and `decor`, and refuse any other.

#### Scenario: New surface words accepted
- **WHEN** a material's `apply` is `['ceiling', 'facade', 'trim']`
- **THEN** the manifest is accepted

#### Scenario: Unknown word refused
- **WHEN** a material's `apply` contains `roof`
- **THEN** the manifest is refused

### Requirement: Facts shape

`facts` SHALL hold `tileM` (`[u, v]` metres, both above 0, or `null`), `grain` (`along_u`, `along_v`, `none`, `unknown`), `suitability` (`plank_floor`, `board`, `continuous`), optional `normalStrength` above 0, `colourMode` (`natural`, `tintable`), optional `tint`, `averageColour` as `#rrggbb`, and `pbr`.

#### Scenario: Normal strength zero refused
- **WHEN** `facts.normalStrength` is `0`
- **THEN** the manifest is refused

#### Scenario: Average colour not hex
- **WHEN** `facts.averageColour` is `rgb(10, 10, 10)` or `#abc`
- **THEN** the manifest is refused

### Requirement: Tint by colour mode

`tint` SHALL be present exactly when `colourMode` is `tintable`. A tint SHALL be `{ recipe: 'luma-mid@1', suggestedColours }` with at least one suggested colour, each `{ name, hex }` with `hex` as `#rrggbb`.

#### Scenario: Tintable without tint
- **WHEN** a material is `tintable` and has no `tint`
- **THEN** the manifest is refused

#### Scenario: Natural with tint
- **WHEN** a material is `natural` and carries `tint`
- **THEN** the manifest is refused

#### Scenario: Empty suggested colours
- **WHEN** `tint.suggestedColours` is an empty list
- **THEN** the manifest is refused

### Requirement: PBR values and ranges

`facts.pbr` SHALL accept only `baseColour`, `roughness`, `metalness`, `alphaMode` (`opaque`, `blend`, `mask`), `opacity`, `sheen`, `sheenColour`, `clearcoat`, `clearcoatRoughness`, `transmission`, `ior`, `thicknessM`, `attenuationDistanceM`, `attenuationColour`, `emissive` and `emissiveIntensity`. Colours SHALL be `#rrggbb`; ranges are in the scenarios.

#### Scenario: Unit-interval values
- **WHEN** any of roughness, metalness, opacity, sheen, clearcoat, clearcoatRoughness or transmission is below 0 or above 1
- **THEN** the manifest is refused

#### Scenario: Index of refraction
- **WHEN** `ior` is below 1 or above 2.333
- **THEN** the manifest is refused

#### Scenario: Non-negative distances and intensity
- **WHEN** `thicknessM`, `attenuationDistanceM` or `emissiveIntensity` is below 0
- **THEN** the manifest is refused

#### Scenario: Non-finite number
- **WHEN** any numeric field is `NaN` or infinite
- **THEN** the manifest is refused

### Requirement: Map roles and colour spaces

`maps` SHALL be a strict record over the roles `albedo`, `albedoTint`, `normal`, `roughness`, `ao` and `arm`. Each map SHALL be `{ colourSpace, convention?, files }`; `colourSpace` SHALL be `srgb` for `albedo` and `albedoTint` and `linear` for every other role, and `convention` SHALL appear only on `normal`, only as `opengl`.

#### Scenario: Wrong colour space
- **WHEN** a `normal` map declares `colourSpace: 'srgb'`
- **THEN** the manifest is refused

#### Scenario: Convention outside normal
- **WHEN** an `arm` map carries `convention: 'opengl'`
- **THEN** the manifest is refused

#### Scenario: Unknown role
- **WHEN** `maps` has a `height` role
- **THEN** the manifest is refused

### Requirement: Scan colour map by colour mode

A `scan` SHALL carry exactly one colour map: a `natural` scan `albedo` and no `albedoTint`, a `tintable` scan `albedoTint` and no `albedo`. `normal` is optional. A scan SHALL have a non-null `tileM`.

#### Scenario: Natural scan with the tint map
- **WHEN** a natural scan carries `albedoTint`
- **THEN** the manifest is refused

#### Scenario: Tintable scan with both colour maps
- **WHEN** a tintable scan carries both `albedo` and `albedoTint`
- **THEN** the manifest is refused

#### Scenario: Scan without tile size
- **WHEN** a scan has `tileM: null`
- **THEN** the manifest is refused

### Requirement: Packed or separate surface maps

A material SHALL ship either `arm`, or `roughness` with `ao` optional, never `arm` together with `roughness` or `ao`. Either form, or neither, is accepted.

#### Scenario: ARM with roughness
- **WHEN** a scan carries `arm` and `roughness`
- **THEN** the manifest is refused

#### Scenario: AO without roughness
- **WHEN** a scan carries `ao` but neither `roughness` nor `arm`
- **THEN** the manifest is refused

#### Scenario: Roughness with AO
- **WHEN** a scan carries `roughness` and `ao` and no `arm`
- **THEN** the manifest is accepted

### Requirement: Parameters materials

A `parameters` material SHALL have `maps: {}`, `tileM: null` and `pbr.baseColour`, and its `averageColour` SHALL equal `pbr.baseColour` (compared case-insensitively).

#### Scenario: Parameters with a map
- **WHEN** a parameters material lists any map
- **THEN** the manifest is refused

#### Scenario: Parameters without base colour
- **WHEN** a parameters material has no `pbr.baseColour`
- **THEN** the manifest is refused

#### Scenario: Average colour disagrees
- **WHEN** a parameters material has `pbr.baseColour: '#808080'` and `averageColour: '#7f7f7f'`
- **THEN** the manifest is refused

### Requirement: Map sizes

Each map's `files` SHALL be a strict record keyed by sizes from `128`, `256`, `384`, `512` and `768`, with at least one size, and every map of one material SHALL list the same set of sizes.

#### Scenario: Unlisted size
- **WHEN** a map lists a `1024` file
- **THEN** the manifest is refused

#### Scenario: Different size sets
- **WHEN** a material's `albedo` lists 256 and 512 and its `arm` lists only 512
- **THEN** the manifest is refused

#### Scenario: No size
- **WHEN** a map's `files` is empty
- **THEN** the manifest is refused

### Requirement: Texture file paths

Every texture file path SHALL be exactly `tex/<versionId>/<role>.<px>.<ext>`, where `versionId` is the material's own, `role` is the map's role, `px` is the size key it is listed under and `ext` is `webp` or `ktx2`; it is a relative path inside the manifest folder. Every file of one material SHALL use the same extension.

#### Scenario: Another version's folder
- **WHEN** a material's file path names a different material's `versionId`
- **THEN** the manifest is refused

#### Scenario: Size key and file disagree
- **WHEN** the file listed under size `512` is `tex/<versionId>/albedo.256.webp`
- **THEN** the manifest is refused

#### Scenario: KTX2 maps
- **WHEN** every file of a material is `tex/<versionId>/<role>.<px>.ktx2`
- **THEN** the manifest is accepted

#### Scenario: Mixed formats in one material
- **WHEN** a material lists its albedo as `.ktx2` and its normal map as `.webp`
- **THEN** the manifest is refused

#### Scenario: Other extension
- **WHEN** a file path ends in `.png`
- **THEN** the manifest is refused

### Requirement: No duplicate texture paths

A texture file path SHALL appear at most once in the whole manifest.

#### Scenario: Two materials share a path
- **WHEN** two materials of one manifest list the same texture file path
- **THEN** the manifest is refused and the issue names the second occurrence

### Requirement: Listed texture file limit

A manifest SHALL be refused when it lists more than `MAX_PROJECT_TEXTURE_FILES` (512) texture files, counting every role and size of every library material, including sizes the viewer will not draw.

#### Scenario: 513 files
- **WHEN** the library materials of a manifest list 513 texture files in total
- **THEN** the manifest is refused with an issue that names the limit

#### Scenario: 512 files
- **WHEN** they list exactly 512
- **THEN** the manifest is accepted

### Requirement: Published texture limits

The shared limits module SHALL export `MAX_TEXTURE_FILE_BYTES` = 2 MiB, `MAX_PROJECT_TEXTURE_BYTES` = 48 MiB and `MAX_PROJECT_TEXTURE_FILES` = 512 under these names, next to `MAX_PROJECT_BYTES`, which stays the separate model budget.

#### Scenario: Constants by name
- **WHEN** the limits module is imported
- **THEN** it exports the three constants with the values 2 097 152, 50 331 648 and 512

### Requirement: Existing members unchanged

The `pbr` and `generator` members SHALL validate and draw exactly as before.

#### Scenario: Legacy manifest
- **WHEN** a manifest with only `pbr` and `generator` materials is parsed
- **THEN** it is accepted and drawn as before, the `pbr` one flat with its existing warning
