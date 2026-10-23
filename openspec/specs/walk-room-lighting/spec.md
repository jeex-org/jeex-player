# walk-room-lighting Specification

## Purpose
How walk and tour light each room: a light-probe grid per room for indirect light, a box-projected reflection probe per room, light that ignores walls switched off there, and how they are baked, refreshed and restored.

## Requirements

### Requirement: Room grids in walk and tour

In `walk` and `tour` everything in a room (shell, furniture, fixtures, door leaves, window parts) SHALL be lit indirectly by that room's light-probe grid, with one bounce through doorways; everything outside the rooms by a fixed hemisphere-equivalent grid. Grids SHALL be baked before they light the view.

#### Scenario: Windowless room darker
- **WHEN** a closed room without a window and a room with a window are compared in walk on a 0.18 grey patch
- **THEN** the closed room's patch reads at most 0.35 of the window room's

#### Scenario: Every shell mesh in its room
- **WHEN** the scene is built or rebuilt
- **THEN** every wall face, floor, ceiling and skirting mesh is lit by its own room's grid (in a concave room, by one of its sub-boxes' grids) and its world-space vertices are unchanged

#### Scenario: Furniture by the wall
- **WHEN** a cabinet stands against the bathroom wall with its origin on the floor
- **THEN** it is lit by the bathroom's grid

#### Scenario: Facade
- **WHEN** the exterior is seen from a window in walk
- **THEN** facades look as in the editing modes within 5 %

### Requirement: Light that ignores walls is off in walk and tour

In `walk` and `tour` the hemisphere and fill lights SHALL contribute nothing and the environment SHALL contribute specular only; a fixed ambient floor and a walk exposure factor SHALL apply. Leaving `walk` or `tour` SHALL restore the editing look exactly.

#### Scenario: No double counting
- **WHEN** the environment intensity is doubled in walk
- **THEN** a rough, non-metal grey patch changes by less than 4 %

#### Scenario: Restore
- **WHEN** the viewer enters walk and returns to orbit
- **THEN** an orbit frame is pixel-identical to one taken before entering walk

### Requirement: Room reflection probes

In `walk` and `tour` glossy surfaces SHALL reflect their own room from a probe captured at the room's interior point at 1.5 m height, box-projected onto the room's box, blended with the neighbouring room within 0.4 m of a shared boundary. Probes SHALL be captured without feedback from earlier probes and without mirrors; a fragment outside every room box SHALL reflect the studio environment.

#### Scenario: Reflections line up with walls
- **WHEN** a mirror-like floor reflects a stripe on the far wall
- **THEN** the reflected stripe's screen column matches a reference reflection within 2 px

#### Scenario: No seam at a doorway
- **WHEN** a glossy floor continues through a doorway
- **THEN** its reflection changes smoothly within 0.4 m of the boundary, with no step larger than between neighbouring pixels elsewhere

#### Scenario: Bathroom reflects the bathroom
- **WHEN** a glossy surface in a windowless room is viewed
- **THEN** its reflection contains no window of another room

### Requirement: Bake and refresh

On entry to `walk` or `tour` the grids and probes SHALL be built after the walk chain is ready, a fixed number of probes per frame, while the direct look is shown, then switched on in one frame without a recompile. Edits in walk SHALL refresh only what they affect after a short debounce; a scene load, a full rebuild, a sun change or a context restore SHALL re-bake everything. More than 16 room boxes SHALL keep the direct look and report an error.

#### Scenario: No shader thrash
- **WHEN** the lighting has switched on in walk
- **THEN** the number of compiled programs stays constant over the following 10 frames

#### Scenario: Edit in walk
- **WHEN** a piece of furniture is moved in walk
- **THEN** only its room's probe is re-captured, after the debounce; a finish change in a room re-bakes that room's grid and probe

#### Scenario: Capture during the bake
- **WHEN** a still is captured in walk before the bake is done
- **THEN** it shows the direct look

### Requirement: Captures

Stills, video frames and panoramas of the live state in `walk` or `tour` after the bake SHALL show the room lighting at the walk exposure; captures of other states MAY show the editing look.

#### Scenario: Panorama in walk
- **WHEN** a panorama is captured in walk after the bake
- **THEN** the windowless room is darker than the window room as on screen

#### Scenario: Still in walk
- **WHEN** a still of the live state is captured in walk after the bake
- **THEN** the windowless room is as dark in the still as on screen within 2 %
