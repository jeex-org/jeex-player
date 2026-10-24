# Spec Delta

## MODIFIED Requirements

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
