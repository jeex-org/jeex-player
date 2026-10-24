## MODIFIED Requirements

### Requirement: Room grids in walk and tour

In `walk` and `tour` everything in a room (shell, furniture, fixtures, door leaves, window parts) SHALL be lit indirectly by that room's light-probe grid, with one bounce through doorways; everything outside the rooms by a fixed hemisphere-equivalent grid. Grids SHALL be baked before they light the view. A baked surface SHALL take no light from any grid: its lightmap is its indirect light.

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
- **WHEN** the exterior is seen from a window in walk
- **THEN** facades look as in the editing modes within 5 %

#### Scenario: Baked shell ignores the grid
- **WHEN** the room grid's irradiance is doubled in walk
- **THEN** a grey zero-specular baked floor in that room does not change, while an unbaked card beside it does

## ADDED Requirements

### Requirement: Baked surfaces in walk and tour

In walk and tour a baked surface inside a room box SHALL show its lightmap scaled by the walk sun factor, its direct sun scaled as on any surface, and its reflections from the room probes. Outside every room box its lightmap factor SHALL be 1, its reflections SHALL come from the studio environment and the existing outside exposure compensation SHALL apply; the diffuse sources the baked policy excludes SHALL stay excluded there. Captures for grids and probes SHALL see its unscaled lightmap.

#### Scenario: Baked room in walk
- **WHEN** a baked room is viewed in walk after the bake of grids and probes
- **THEN** its lightmap contribution is the editing contribution times the walk sun factor and its glossy surfaces reflect the room probe

#### Scenario: Baked surface outside the rooms
- **WHEN** a baked surface outside every room box is read in walk and in an editing mode
- **THEN** its walk reading is its editing reading times the outside exposure compensation, its lightmap unscaled, and the exterior grid adds no diffuse light to it

#### Scenario: Unscaled lightmap in a grid capture
- **WHEN** a room grid is baked in walk with a baked surface in view of a grid probe
- **THEN** the probe sees the surface's unscaled lightmap, read back from the capture within the tolerance

#### Scenario: No shader change on entry
- **WHEN** the viewer enters walk with baked surfaces in view, the bake completes and the room lighting switches on
- **THEN** no program is compiled in the swap frame or after it; the first installation and the bake warm-up may compile
