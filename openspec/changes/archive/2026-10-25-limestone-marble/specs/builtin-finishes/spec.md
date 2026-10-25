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
- **WHEN** a floor is painted with Warm stone porcelain or Graphite porcelain
- **THEN** it is drawn as its library material, whose tile size makes one tile 0.6 m wide

#### Scenario: Continuous stone finish
- **WHEN** a floor is painted with Cream limestone
- **THEN** it is drawn as a honed stone scan tinted warm cream, repeating every 1.5 m (the scan's real size), with no grid of its own

#### Scenario: No kept finish
- **WHEN** the shipped index is read
- **THEN** every bundled floor and wall finish is either bound to a library version or an alias, and none is kept

#### Scenario: Ceiling of a room that names none
- **WHEN** a room names no ceiling finish
- **THEN** its ceiling wears the default ceiling finish as a library material, and clearing a room's own ceiling finish returns it to that material
