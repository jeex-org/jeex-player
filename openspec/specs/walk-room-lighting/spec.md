# walk-room-lighting Specification

## Purpose
How walk and tour light each room: a light-probe grid per room for indirect light, a box-projected reflection probe per room placed clear of the furniture, light that ignores walls switched off there, emissive glow held under the display knee, and how they are baked, refreshed and restored.

## Requirements

### Requirement: Room grids in walk and tour

In `walk` and `tour` everything in a room (shell, furniture, fixtures, door leaves, window parts) SHALL be lit indirectly by that room's light-probe grid, with one bounce through doorways; everything outside the rooms by a fixed hemisphere-equivalent grid (requirement «Exterior light under the HDRI» for the HDRI). Grids SHALL be baked before they light the view. A baked surface SHALL take no light from any grid: its lightmap is its indirect light.

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

### Requirement: Exterior light under the HDRI

In the HDRI full-lighting states (capability `hdri-sky`) everything outside the rooms SHALL be lit by the HDRI environment, with the fixed exterior grid adding nothing.

#### Scenario: Exterior grid silent under the HDRI
- **WHEN** the HDRI is live in walk and the exterior grid's coefficients are doubled
- **THEN** a grey card outside every room box does not change

### Requirement: Light that ignores walls is off in walk and tour

In `walk` and `tour` the hemisphere and fill lights SHALL contribute nothing and the environment SHALL contribute specular only; a fixed ambient floor and a walk exposure factor SHALL apply. Leaving `walk` or `tour` SHALL restore the editing look exactly.

#### Scenario: No double counting
- **WHEN** the environment intensity is doubled in walk
- **THEN** a rough, non-metal grey patch changes by less than 4 %

#### Scenario: Restore
- **WHEN** the viewer enters walk and returns to orbit
- **THEN** an orbit frame is pixel-identical to one taken before entering walk

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

### Requirement: Bake and refresh

On entry to `walk` or `tour` the grids and probes SHALL be built after the walk chain is ready, a fixed number of probes per frame, while the direct look is shown, then switched on in one frame without a recompile. Edits in walk SHALL refresh only what they affect after a short debounce; a scene load, a full rebuild, a sun change or a context restore SHALL re-bake everything. More than 16 room boxes SHALL keep the direct look and report an error.

#### Scenario: No shader thrash
- **WHEN** the lighting has switched on in walk
- **THEN** the number of compiled programs stays constant over the following 10 frames

#### Scenario: Edit in walk
- **WHEN** a piece of furniture is moved in walk
- **THEN** after the debounce its room's probe is re-captured, together with the probe of every other room whose probe point the move changed, and no other probe or grid; a finish change in a room re-bakes that room's grid and probe

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

### Requirement: Direct sunlight inside rooms in walk and tour

In walk and tour, direct sunlight reaching surfaces inside a room box SHALL be scaled by the walk sun factor (1/3.5 of the editing value at the walk exposure 3.5), so sunlit floors keep their texture; surfaces outside rooms, the editing modes and captures of other states SHALL keep the unscaled sun. The windowless room SHALL keep reading at most 0.35 of the window room on a grey card, and the window room 0.25–0.45 of its editing value.

#### Scenario: Sunlit floor not clipped
- **WHEN** the demo apartment's sunlit floor is viewed in walk (a 64 × 64 px region where direct sun adds the most, at the sun preset that reaches a floor a room camera sees: noon; the evening sun reaches none)
- **THEN** fewer than 1 % of its pixels are at the display maximum, and the standard deviation of its luminance is larger than with the factor off and at least 80 % of the editing view's

#### Scenario: Lamps unaffected by the sun factor
- **WHEN** a lamp-lit card inside a room is compared with the sun factor on and off
- **THEN** its lamp contribution is unchanged

#### Scenario: Façades keep their sun
- **WHEN** a façade is viewed in walk
- **THEN** it reads as in the editing modes within 5 %

### Requirement: Baked surfaces under the walk lighting

In walk and tour a baked surface SHALL show its lightmap times the walk gain (`LIGHTING_STANDARD.baked.exposure.walk`) at the walk exposure, never scaled by the walk sun factor; its sun SHALL be scaled as on any surface, its reflections inside a room box SHALL come from the room probes. Outside every box it SHALL read as in the editing modes, like a facade. Captures SHALL see what walk shows.

#### Scenario: Baked room in walk
- **WHEN** a baked room is viewed in walk after the bake of grids and probes
- **THEN** its lightmap contribution is the editing contribution times the walk gain over the editing gain, and its glossy surfaces reflect the room probe

#### Scenario: Baked surface outside the rooms
- **WHEN** a baked surface outside every room box is read in walk and in an editing mode
- **THEN** its walk reading is its editing reading times the outside exposure compensation, so under the walk exposure it reads as in the editing modes within the tolerance, its capture reading equals its editing reading, and the exterior grid adds no diffuse light to it

#### Scenario: Lightmap with the walk gain in a grid capture
- **WHEN** a room grid is baked in walk with a baked surface in view of a grid probe
- **THEN** the probe sees the surface's lightmap times the walk gain, read back from the capture within the tolerance

#### Scenario: No shader change on entry
- **WHEN** the viewer enters walk with baked surfaces in view, the bake completes and the room lighting switches on
- **THEN** no program is compiled in the swap frame or after it; the first installation and the bake warm-up may compile

### Requirement: Reflection probe placement

Each room SHALL have one probe point at 1.5 m, chosen among bounded lattice candidates inside the room. Candidates at least 0.5 m in 3D from every furniture box qualify; among them the highest wall-distance score (distance to the room's edges, slightly biased to its centre) wins. Without one, the highest min(furniture clearance, edge distance) wins, then the score. Ties keep the first in the fixed traversal order.

#### Scenario: Floor lamp in the middle of the room
- **WHEN** a floor lamp whose shade reaches the probe height stands at the centre of a room that has a qualifying candidate
- **THEN** the probe point is at least 0.5 m from the lamp's box

#### Scenario: Low furniture does not push the probe
- **WHEN** a sofa 0.8 m high stands at the centre of a room
- **THEN** the probe point is the same as in the empty room

#### Scenario: No point clears the furniture
- **WHEN** furniture leaves no point of a room 0.5 m clear
- **THEN** the probe point is the candidate inside the room with the largest min(furniture clearance, edge distance), ties decided by the score and then the traversal order

#### Scenario: Deterministic
- **WHEN** the placement runs twice on the same rooms and furniture
- **THEN** it answers the same points

#### Scenario: Demo living room
- **WHEN** the demo apartment is loaded in walk
- **THEN** the living room's probe point is at least 0.5 m from the floor lamp's box, and the lamp's shade no longer fills the probe's upward view

### Requirement: Probe placement follows furniture edits

After a furniture edit in walk the probe points SHALL be recomputed from the current furniture; a room whose probe point changed SHALL be captured at its new point, and every room box of that room SHALL project its reflections from the new point.

#### Scenario: Lamp moved next to the probe
- **WHEN** a floor lamp is moved in walk to within 0.2 m of its room's probe point, the room still has a qualifying candidate, and the debounce passes
- **THEN** the room's probe is captured at a point at least 0.5 m from the lamp's new box, every box of that room uses that point for its reflections, the refresh causes a display draw and the view then rests

#### Scenario: Another room's point moves
- **WHEN** a furniture edit in walk changes the probe point of a room other than the edited one
- **THEN** that room's probe is re-captured at its new point in the same refresh

#### Scenario: Edit during the initial bake
- **WHEN** furniture is moved in walk before the bake is done
- **THEN** the bake restarts and captures every probe at the points computed from the current furniture

#### Scenario: Room boxes changed
- **WHEN** a refresh finds that the current rooms give different projection boxes than the loaded ones
- **THEN** the lighting reloads the document and re-bakes everything

#### Scenario: With a host sky
- **WHEN** a probe placement refresh happens in walk with a host sky (HDRI) installed
- **THEN** the re-captured probe keeps the atlas's fixed sampling and tile size and the rig returns to the state it had before the capture

#### Scenario: Edit that does not change placement
- **WHEN** a piece of furniture is moved in walk and no room's probe point changes
- **THEN** only its room's probe is re-captured, at the same point

### Requirement: Glossy finishes read as glossy

In walk, on the demo living-room fixture (recorded pose, resolution and floor mask), the floor's specular contrast (99th percentile over median of linear specular luminance, floor black, non-metal, map-free) at roughness 0.07 SHALL be at least 2.2 times that at 0.6, and that ratio SHALL be at least 1.15 times the one read with the probe at the footprint rule's point; where geometry puts the window's mirror image on that floor, it SHALL show the window.

#### Scenario: Contrast by roughness
- **WHEN** the demo living-room floor (black, non-metal, map-free) is metered in walk at the recorded pose and resolution, at roughness 0.07 and at 0.6, with the room lighting live on a hardware renderer
- **THEN** the 0.07 floor's contrast of linear specular luminance in the recorded floor mask is at least 2.2 times the 0.6 floor's, and that ratio is at least 1.15 times the ratio with the living probe at (2.70, 1.50, 7.13), where the footprint rule placed it

#### Scenario: Window in a polished floor
- **WHEN** a recorded pose sees the floor band where the living room window's mirror image falls, the floor black, non-metal, map-free at roughness 0.07, with the room lighting live on a hardware renderer
- **THEN** that band is brighter than the floor beside it, in the window's screen column

### Requirement: Emissive surfaces in walk and tour

In `walk` and `tour` the emissive term of every material SHALL be capped so its brightest channel does not exceed one walk value, keeping its chroma (`E × min(1, cap / max(E))`); an emissive term below the cap SHALL pass unchanged. The editing modes SHALL keep their emissive glow exactly.

#### Scenario: Shades not blown out
- **WHEN** the demo floor lamp wears each glowing shade finish (ivory, opal, warm lamp, ink) and is metered in walk before tone mapping
- **THEN** the shade's mean brightest channel is at most 0.76 and at least 1.25 times the same shade with its emissive off

#### Scenario: Editing glow unchanged
- **WHEN** the same shade is metered in orbit, `plan3d` and the editing look before and after a walk session
- **THEN** its readings are unchanged

### Requirement: Probe atlas independent of the environment's size

The room probes' atlas SHALL be captured and sampled at its own fixed cube size, whatever the size of the scene's environment; a capture SHALL be checked against the atlas's own layout, not against the environment's.

#### Scenario: 1K environment
- **WHEN** an HDRI whose prefiltered cube is 256 is installed and the room probes are captured
- **THEN** no layout error is raised, and a glossy floor's reflected stripe matches the reflection under the recipe environment within 2 px
