# Spec Delta

## MODIFIED Requirements

### Requirement: Built-in finishes draw library materials

Every bundled floor and wall finish and the default ceiling finish that the shipped index binds to a library material SHALL be drawn as that material (scanned maps, or parameters only), with the same tint, tile, grain and PBR rules as a project library material. A finish the index lists as kept SHALL keep its generated look; the shipped index lists none.

#### Scenario: Bare scene floor
- **WHEN** a scene without a project paints a floor with the bundled oak finish
- **THEN** the floor is drawn as that finish's library material, flat in its first-frame colour first, its maps attached once loaded

#### Scenario: Kept finish
- **WHEN** an index lists a finish as kept
- **THEN** that finish draws its generated look, exactly as before

#### Scenario: Tiled finish
- **WHEN** a floor is painted with Cream limestone, Warm stone porcelain or Graphite porcelain
- **THEN** it is drawn as its library material, whose tile size makes one tile 0.62 m, 0.6 m and 0.6 m wide

#### Scenario: No kept finish
- **WHEN** the shipped index is read
- **THEN** every bundled floor and wall finish is either bound to a library version or an alias, and none is kept

#### Scenario: Ceiling of a room that names none
- **WHEN** a room names no ceiling finish
- **THEN** its ceiling wears the default ceiling finish as a library material, and clearing a room's own ceiling finish returns it to that material

### Requirement: Identity and order kept

Each bundled finish SHALL keep its id; existing rows SHALL keep their relative order in the picker, new finishes following them and aliases leaving it; a finish's name SHALL be the library's name for it. Documents SHALL validate under the same ids, and the light-bake input hash of a document SHALL not change.

#### Scenario: Stable id
- **WHEN** a document painted with a bundled finish id before this change is loaded
- **THEN** it validates unchanged and its bake input hash equals the earlier one

#### Scenario: Renamed finish
- **WHEN** the wall picker lists the finish formerly named Graphite
- **THEN** it is listed under the same id as Mocha

### Requirement: Shipped folder integrity

The shipped folder SHALL hold an index listing, for every bundled finish, its library variant, pinned version and name, that it is kept, or the target of an alias, and for every file its byte size and SHA-256; every listed file SHALL exist with that size and hash, every role SHALL list the same sizes, no file SHALL exceed the per-file texture cap, and a source list SHALL name each scan's provider, source page and licence.

#### Scenario: Corrupted file
- **WHEN** a shipped map's bytes differ from its recorded hash
- **THEN** the repository's tests fail

#### Scenario: Alias disagreement
- **WHEN** an alias entry of the index names a different target than the player's alias records
- **THEN** the repository's tests fail

## RENAMED Requirements

- FROM: `### Requirement: Identity, name and order kept`
- TO: `### Requirement: Identity and order kept`

## ADDED Requirements

### Requirement: Aliases resolve to their target

A bundled alias id SHALL validate on the surfaces its target accepts and SHALL be drawn as its target's current bundled look, unless the project ships a material under the alias id itself. The player SHALL never rewrite a stored alias id, and an alias SHALL carry no material of its own.

#### Scenario: Retired stripes in a document
- **WHEN** a document paints a wall with Cream stripes
- **THEN** the wall draws Warm white's library material, and after another edit the serialised document still names Cream stripes on that wall

#### Scenario: Retired floor
- **WHEN** a document paints a floor with Bleached ash
- **THEN** the floor draws Natural oak's library material

#### Scenario: Project material under the alias id
- **WHEN** a project ships a generator material under the Cream stripes id and a wall names Cream stripes
- **THEN** the wall draws the project's material

#### Scenario: Project material under the target id only
- **WHEN** a project ships a material under Warm white's id and a wall still names Cream stripes
- **THEN** that wall draws the bundled Warm white library material

### Requirement: New bundled finishes

The bundled finishes SHALL include Pure white, Ink blue, Polished lime plaster, Sand microcement, Warm grey microcement, Honed travertine, White marble, Stone porcelain 60x60 and Teal zellige as wall finishes, and Herringbone oak and Dark oak herringbone as floor finishes, each under the id the library gives it and drawn as its library material.

#### Scenario: New wall finish
- **WHEN** the wall picker of a bare scene is opened
- **THEN** it offers Teal zellige, and picking it paints the wall with the zellige scan

#### Scenario: New floor finish
- **WHEN** a set_material names Herringbone oak on a room
- **THEN** it is routed to the room's floor

### Requirement: Clear coat on library materials

A library material whose PBR facts carry a clear coat SHALL be drawn with the physical model, with that clear coat and clear-coat roughness.

#### Scenario: Glazed tile
- **WHEN** a wall is painted with Teal zellige
- **THEN** its material is physical with clear coat 1 and clear-coat roughness 0.08
