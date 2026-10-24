# builtin-finishes Specification

## Purpose
The player's bundled room finishes render library materials whose maps ship beside the player, so a scene without a project gets scanned surfaces instead of generated textures.

## Requirements

### Requirement: Built-in finishes draw library materials

Every bundled floor and wall finish and the default ceiling finish that the shipped index binds to a library material SHALL be drawn as that material (scanned maps, or parameters only), with the same tint, tile, grain and PBR rules as a project library material. Only Cream stripes and Sage stripes SHALL be listed as kept, and a kept finish SHALL keep its generated look.

#### Scenario: Bare scene floor
- **WHEN** a scene without a project paints a floor with the bundled oak finish
- **THEN** the floor is drawn as that finish's library material, flat in its first-frame colour first, its maps attached once loaded

#### Scenario: Kept finish
- **WHEN** a wall is painted with Cream stripes or Sage stripes
- **THEN** that finish draws its generated look, exactly as before

#### Scenario: Tiled finish
- **WHEN** a floor is painted with Warm limestone, Light ceramic or Graphite ceramic, or a wall with White wall tiles
- **THEN** it is drawn as its library material, whose tile size makes one tile as large as the finish's generated tile (0.62 m, 0.625 m, 0.625 m and 0.3 m)

#### Scenario: Ceiling of a room that names none
- **WHEN** a room names no ceiling finish
- **THEN** its ceiling wears the default ceiling finish as a library material, and clearing a room's own ceiling finish returns it to that material

### Requirement: Identity, name and order kept

Each bundled finish SHALL keep its id, its name and its position in the picker. Documents that name a bundled finish SHALL validate and resolve exactly as before, and the light-bake input hash of a document SHALL not change.

#### Scenario: Stable id
- **WHEN** a document painted with a bundled finish id before this change is loaded
- **THEN** it validates unchanged and its bake input hash equals the earlier one

### Requirement: Project materials win

A project material whose id equals a bundled finish id SHALL be drawn instead of the bundled library material, whichever kind the project material is. The picker SHALL list such an id once.

#### Scenario: Project override
- **WHEN** a project ships a generator material under the bundled sand id
- **THEN** walls painted sand draw the project's material and the picker shows one sand option

### Requirement: Maps ship beside the player

The maps of bundled finishes SHALL be loaded from a `finish-maps/` folder next to the running player file. They SHALL never be fetched from a store or a texture provider, and never through the host's texture resolver.

#### Scenario: Host resolver present
- **WHEN** a host passes `resolveTexture` and a bare scene shows a bundled scan
- **THEN** the scan's maps are fetched from the player's own folder and the resolver is not called for them

### Requirement: Maps load on use, by device class

A bundled finish's maps SHALL be fetched only when a surface on screen wears it, or an export draws it, at the size the device class asks for (256, 512 or 768 px). Texture work SHALL start after the first frame, and maps already fetched SHALL be reused across documents, context restores and exports of the same viewer.

#### Scenario: Unused finish
- **WHEN** a scene uses oak floors and sand walls only
- **THEN** no file of any other bundled finish is fetched

#### Scenario: Document swap
- **WHEN** a second bare scene with oak floors is loaded into the same viewer
- **THEN** the oak maps are not fetched again

#### Scenario: Export of a finish not on screen
- **WHEN** an export with the catalogue defaults draws a bundled finish no surface on screen wears
- **THEN** that finish's maps are fetched from the player's folder at the device's size

### Requirement: Missing maps

When the folder or a file is missing, the surface SHALL stay flat in its first-frame colour and the viewer SHALL log one warning per viewer for bundled maps, never one per file, and never throw.

#### Scenario: Player copied alone
- **WHEN** the IIFE file is served without its `finish-maps/` folder
- **THEN** every bundled surface draws its flat library colour and one warning is logged

### Requirement: No context, no fetch

Without a WebGL context the viewer SHALL fetch no bundled map, and bundled surfaces SHALL keep their first-frame colours.

#### Scenario: Headless
- **WHEN** a scene mounts with no WebGL context
- **THEN** no bundled map request is made

### Requirement: Built-in swatches

A bound bundled finish's picker swatch SHALL show the shipped smallest albedo of a natural scan, and otherwise a flat chip in the finish's first-frame colour. An interior preset chip SHALL show the flat colours of its two finishes when either is bound. A kept finish keeps its current swatch.

#### Scenario: Paint swatch
- **WHEN** the wall picker lists a bundled parameter-only paint
- **THEN** its chip is flat in the paint's colour

### Requirement: Shipped folder integrity

The shipped folder SHALL hold an index listing, for every bundled finish, its library variant and pinned version or that it is kept, and for every file its byte size and SHA-256; every listed file SHALL exist with that size and hash, every role SHALL list the same sizes, no file SHALL exceed the per-file texture cap, and a source list SHALL name each scan's provider, source page and licence.

#### Scenario: Corrupted file
- **WHEN** a shipped map's bytes differ from its recorded hash
- **THEN** the repository's tests fail

### Requirement: Export of built-in surfaces

GLB and USDZ export of a mounted viewer SHALL write surfaces that wear a bundled finish with that finish's maps, as the textured export of library materials defines; without a mounted viewer's texture sources they SHALL be written in the finish's flat first-frame colour.

#### Scenario: Exported floor
- **WHEN** a bare scene with oak floors is exported to GLB from a mounted viewer whose oak maps are available
- **THEN** the floor material carries oak's albedo, normal and ARM images and no generated texture

#### Scenario: Exported floor without a viewer
- **WHEN** a bare scene with oak floors is exported without a mounted viewer
- **THEN** the floor material's base colour is oak's first-frame colour and it carries no texture
