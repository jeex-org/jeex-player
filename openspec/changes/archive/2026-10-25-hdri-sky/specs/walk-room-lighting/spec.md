## MODIFIED Requirements

### Requirement: Room grids in walk and tour

In `walk` and `tour` everything in a room (shell, furniture, fixtures, door leaves, window parts) SHALL be lit indirectly by that room's light-probe grid, with one bounce through doorways; everything outside the rooms by a fixed hemisphere-equivalent grid, or, in the HDRI full-lighting states (capability `hdri-sky`), by the HDRI environment with that grid adding nothing. Grids SHALL be baked before they light the view. A baked surface SHALL take no light from any grid: its lightmap is its indirect light.

#### Scenario: Windowless room darker
- **WHEN** a closed room without a window and a room with a window are compared in walk on a 0.18 grey patch
- **THEN** the closed room's patch reads at most 0.35 of the window room's

#### Scenario: Every shell mesh in its room
- **WHEN** the scene is built or rebuilt
- **THEN** every wall face, floor, ceiling and skirting mesh is lit by its own room's grid (in a concave room, by one of its sub-boxes' grids) and its world-space vertices are unchanged, unless its material is a baked surface

#### Scenario: Furniture by the wall
- **WHEN** a cabinet stands against the bathroom wall with its origin on the floor
- **THEN** it is lit by the bathroom's grid

#### Scenario: Facade
- **WHEN** the exterior is seen from a window in walk without an HDRI
- **THEN** facades look as in the editing modes within 5 %

#### Scenario: Baked shell ignores the grid
- **WHEN** the room grid's irradiance is doubled in walk
- **THEN** a grey zero-specular baked floor in that room does not change, while an unbaked card beside it does

#### Scenario: Exterior grid silent under the HDRI
- **WHEN** the HDRI is live in walk and the exterior grid's coefficients are doubled
- **THEN** a grey card outside every room box does not change

### Requirement: Room reflection probes

In `walk` and `tour` glossy surfaces SHALL reflect their own room from a probe captured at the room's probe point (requirement «Reflection probe placement»), box-projected onto the room's box, blended with the neighbouring room within 0.4 m of a shared boundary. Probes SHALL be captured without feedback from earlier probes and without mirrors; a fragment outside every room box SHALL reflect the scene's environment: the studio environment, or the HDRI in its full-lighting states.

#### Scenario: Reflections line up with walls
- **WHEN** a mirror-like floor reflects a stripe on the far wall
- **THEN** the reflected stripe's screen column matches a reference reflection within 2 px

#### Scenario: No seam at a doorway
- **WHEN** a glossy floor continues through a doorway
- **THEN** its reflection changes smoothly within 0.4 m of the boundary, with no step larger than between neighbouring pixels elsewhere

#### Scenario: Bathroom reflects the bathroom
- **WHEN** a glossy surface in a windowless room is viewed
- **THEN** its reflection contains no window of another room

#### Scenario: Outside reflects the HDRI
- **WHEN** a mirror-like card outside every room box faces the HDRI's sun spot with the HDRI live
- **THEN** it reflects the spot

## ADDED Requirements

### Requirement: Probe atlas independent of the environment's size

The room probes' atlas SHALL be captured and sampled at its own fixed cube size, whatever the size of the scene's environment; a capture SHALL be checked against the atlas's own layout, not against the environment's.

#### Scenario: 1K environment
- **WHEN** an HDRI whose prefiltered cube is 256 is installed and the room probes are captured
- **THEN** no layout error is raised, and a glossy floor's reflected stripe matches the reflection under the recipe environment within 2 px
