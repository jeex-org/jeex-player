# library-material-export Specification

## Purpose
How GLB and USDZ export write the room surfaces a library material draws (project library materials and bundled finishes): which material they wear, which maps travel with them, and what happens when a map is missing.

## Requirements

### Requirement: Surfaces resolve as on screen

An export of a mounted viewer SHALL draw every room surface with the material the live view resolves for it: a project material of any kind first, then the bundled finishes, then the legacy catalogue. Furniture SHALL be exported as before this change.

#### Scenario: Project material on a wall
- **WHEN** a project scene paints a wall with one of its library materials and is exported
- **THEN** the wall's exported material is that library material, not the bundled catalogue's or the default wall finish

#### Scenario: Bundled finish
- **WHEN** a bare scene with oak floors is exported from a mounted viewer
- **THEN** the floor's exported material is the oak library material

#### Scenario: Project generator over a bundled id
- **WHEN** a project ships a generator material under a bundled finish id and a wall wears it
- **THEN** the exported wall wears the project's material, not the bundled library material

### Requirement: Maps from the viewer's own sources

The maps SHALL come only from the texture sources the live view draws from: the project's source for project materials and the player's bundled source for bundled finishes, at the size the live view loads for the device. Bytes already fetched SHALL be reused; no other location SHALL be fetched.

#### Scenario: Live maps reused
- **WHEN** the live view has loaded a surface's maps and the scene is exported
- **THEN** the export fetches no file

#### Scenario: Map not yet asked for
- **WHEN** an export draws a finish the live view never showed
- **THEN** its maps are requested through the same source, with its resolver, limits and deadline

### Requirement: Maps written to GLB

A textured library surface SHALL be written with its colour map as `baseColorTexture`, its normal map as `normalTexture`, and its ARM map as both `occlusionTexture` and `metallicRoughnessTexture` from one image; roughness and metalness SHALL be the factors, all on texture coordinate set 0.

#### Scenario: Scanned floor
- **WHEN** a floor with albedo, normal and ARM maps is exported to GLB
- **THEN** its material has a base colour, a normal, an occlusion and a metallic-roughness texture, the last two naming the same image

### Requirement: Colour factor within range

Every written `baseColorFactor` SHALL lie in `[0, 1]`. A colour map's live factor (tint times recipe gain times any base colour) within range SHALL be written as is; above it, the export SHALL write a derived image, each texel times the factor in linear light clamped to 1, with a white factor. A flat surface's colour SHALL be clamped per component.

#### Scenario: Tinted paint
- **WHEN** a tintable scan with a light tint is exported
- **THEN** every `baseColorFactor` component lies in `[0, 1]` and the colour image equals the tint map times the factor, clamped

#### Scenario: Natural scan
- **WHEN** a natural scan with no base colour is exported
- **THEN** its colour image is the albedo map unchanged and its factor is white

#### Scenario: Flat tintable fallback above range
- **WHEN** a tintable scan whose first-frame colour exceeds 1 in a component is exported without its colour map
- **THEN** that component of its factor is written as 1

### Requirement: Tiling as on screen

Exported texture coordinates of a textured library surface SHALL equal the live texture coordinates: world metres turned by the grain angle and the finish rotation, then divided by the tile size per axis. No texture transform extension SHALL be written for them.

#### Scenario: Rotated non-square tile
- **WHEN** a floor whose material has a non-square tile and a grain along u is exported
- **THEN** each exported vertex's texture coordinate equals the live texture matrix applied to its metre coordinate

### Requirement: Each image once

Each map image SHALL be written once per file however many surfaces wear it, and each derived image (tint, packed separate roughness and metalness) once per source images and factor.

#### Scenario: Oak in several rooms
- **WHEN** three rooms have oak floors and the scene is exported
- **THEN** the file holds one oak albedo image, one normal image and one ARM image

#### Scenario: Separate roughness map in several rooms
- **WHEN** a material with ARM and a separate roughness map floors three rooms
- **THEN** the file holds one metallic-roughness image for it, shared by the three materials

### Requirement: Missing maps

A map that cannot be had at export time SHALL leave that role out exactly as the live view does: no colour map keeps the first-frame colour, normal and ARM still attach. A material whose maps are KTX2 SHALL be exported flat in its first-frame colour with its scalar factors. The export SHALL not fail for a missing map.

#### Scenario: No viewer
- **WHEN** an export runs without a mounted viewer's texture sources
- **THEN** every library surface is flat in its first-frame colour, as before this change

#### Scenario: Colour map failed
- **WHEN** a surface's albedo could not be fetched but its normal and ARM arrived
- **THEN** the exported material has the first-frame colour as its factor, no base colour texture, and the normal and ARM textures

#### Scenario: KTX2 material
- **WHEN** a project material whose maps are KTX2 is exported
- **THEN** its exported material carries no texture and the first-frame colour

### Requirement: Deterministic textured export

Exporting the same document twice in the same browser with the same maps available SHALL give byte-identical GLB files, and the textured GLB of the demo apartment SHALL pass the glTF validator with no error.

#### Scenario: Textured re-export
- **WHEN** a scene with textured library surfaces is exported twice from the same viewer
- **THEN** the two GLB files are byte-identical

#### Scenario: Validator
- **WHEN** the demo apartment is exported with its bundled maps
- **THEN** the glTF validator reports zero errors

### Requirement: USDZ textures

USDZ export SHALL write the same surfaces with UsdPreviewSurface textures: the colour image as diffuse colour with its factor, the normal map, and the ARM image as occlusion (R), roughness (G) and metallic (B) from one file, over the same baked texture coordinates.

#### Scenario: Scanned floor in USDZ
- **WHEN** a floor with albedo, normal and ARM maps is exported to USDZ
- **THEN** the archive holds one image per map and the floor's material reads occlusion, roughness and metallic from the same ARM file
