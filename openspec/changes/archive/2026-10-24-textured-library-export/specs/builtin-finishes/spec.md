# Spec Delta

## MODIFIED Requirements

### Requirement: Export of built-in surfaces

GLB and USDZ export of a mounted viewer SHALL write surfaces that wear a bundled finish with that finish's maps, as the textured export of library materials defines; without a mounted viewer's texture sources they SHALL be written in the finish's flat first-frame colour.

#### Scenario: Exported floor
- **WHEN** a bare scene with oak floors is exported to GLB from a mounted viewer whose oak maps are available
- **THEN** the floor material carries oak's albedo, normal and ARM images and no generated texture

#### Scenario: Exported floor without a viewer
- **WHEN** a bare scene with oak floors is exported without a mounted viewer
- **THEN** the floor material's base colour is oak's first-frame colour and it carries no texture

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
