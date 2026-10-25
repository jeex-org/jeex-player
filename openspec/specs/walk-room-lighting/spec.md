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

On entry to `walk` or `tour` the grids and probes SHALL be built once the walk chain is ready, a fixed number of probes per frame, under the direct look, then switched on in one frame, no recompile. Edits in walk SHALL refresh only what they affect after a debounce; a scene load, a rebuild, a sun change, a context restore and a lamp change (move, removal, addition, swap, tint) SHALL re-bake everything, in walk or tour only. Over 16 room boxes SHALL keep the direct look and report an error.

#### Scenario: No shader thrash
- **WHEN** the lighting has switched on in walk
- **THEN** the number of compiled programs stays constant over the following 10 frames

#### Scenario: Edit in walk
- **WHEN** a piece of furniture without a lamp light is moved in walk
- **THEN** after the debounce its room's probe is re-captured, together with the probe of every other room whose probe point the move changed, and no other probe or grid; a finish change in a room re-bakes that room's grid and probe

#### Scenario: Lamp moved in walk
- **WHEN** a lamp is moved in walk by the move command from one room to another, or out of every room, and the debounce passes
- **THEN** every grid and then every probe is baked again, and the lamp lights directly only its new room, or no room

#### Scenario: Lamp removed or swapped in walk
- **WHEN** a lamp, the last one included, is removed by the remove command, or swapped to a variant with another light, in walk
- **THEN** after the debounce every grid and probe is baked again

#### Scenario: No stale lamp light
- **WHEN** a lamp is removed in walk and the re-bake completes
- **THEN** every grid's readings equal those of a fresh bake of the same scene loaded without that lamp, within the recorded tolerance

#### Scenario: Temperature changed in an editing mode
- **WHEN** the light temperature changes in orbit after a walk session and the viewer then enters walk
- **THEN** no re-bake runs in orbit, and the walk view that turns live shows the new tint in its grids and probes, never the old one

#### Scenario: Temperature changed during the initial bake
- **WHEN** the light temperature changes in walk before the first bake is done
- **THEN** the bake restarts and the lighting turns live with the new tint

#### Scenario: Temperature unchanged
- **WHEN** the temperature is set in walk to the value the live lighting was baked with
- **THEN** nothing is re-baked

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

In walk by daylight (lamps off, freshly baked), on the demo living-room fixture (recorded pose, resolution, floor mask), the floor's specular contrast (99th percentile over median of linear specular luminance, floor black, non-metal, map-free) at roughness 0.07 SHALL be at least 2.2 times that at 0.6, and that ratio SHALL be at least 1.15 times the one read with the probe at the footprint rule's point; where geometry puts the window's mirror image on that floor, it SHALL show the window.

#### Scenario: Contrast by roughness
- **WHEN** the demo living-room floor (black, non-metal, map-free) is metered in walk at the recorded pose and resolution, at roughness 0.07 and at 0.6, with the room lighting live by daylight (every lamp off, freshly baked) on a hardware renderer
- **THEN** the 0.07 floor's contrast of linear specular luminance in the recorded floor mask is at least 2.2 times the 0.6 floor's, and that ratio is at least 1.15 times the ratio with the living probe at (2.70, 1.50, 7.13), where the footprint rule placed it

#### Scenario: Window in a polished floor
- **WHEN** a recorded pose sees the floor band where the living room window's mirror image falls, the floor black, non-metal, map-free at roughness 0.07, with the room lighting live by daylight (every lamp off, freshly baked) on a hardware renderer
- **THEN** that band is brighter than the floor beside it, in the window's screen column

#### Scenario: Lamps on, recorded
- **WHEN** the same two measurements are taken with the default lamps on
- **THEN** they are recorded beside the daylight ones as diagnostics: the lamps' light in the probes lifts the floor's specular median and is not what these checks judge

### Requirement: Emissive surfaces in walk and tour

In `walk` and `tour` the emissive term of every material SHALL be capped so its brightest channel does not exceed one walk value, keeping its chroma (`E × min(1, cap / max(E))`); an emissive term below the cap SHALL pass unchanged. The editing modes SHALL keep their emissive glow exactly.

#### Scenario: Shades not blown out
- **WHEN** the demo floor lamp wears each glowing shade finish (ivory, opal, warm lamp, ink) and is metered in walk before tone mapping
- **THEN** the shade's mean brightest channel is at most 1.52 (the highest lamps-on reading measured when the lamps joined the room grids, 1.38, plus 10 %: the light a lamp bounces off the ceiling and walls lands on its own shade) and at least 1.20 times the same shade with its emissive off (1.25 before the lamps fed the room grids: the same bounce raises the unlit shade)

#### Scenario: Editing glow unchanged
- **WHEN** the same shade is metered in orbit, `plan3d` and the editing look before and after a walk session
- **THEN** its readings are unchanged

### Requirement: Probe atlas independent of the environment's size

The room probes' atlas SHALL be captured and sampled at its own fixed cube size, whatever the size of the scene's environment; a capture SHALL be checked against the atlas's own layout, not against the environment's.

#### Scenario: 1K environment
- **WHEN** an HDRI whose prefiltered cube is 256 is installed and the room probes are captured
- **THEN** no layout error is raised, and a glossy floor's reflected stripe matches the reflection under the recipe environment within 2 px

### Requirement: Lamps feed the room grids

In `walk` and `tour` every lamp (every artificial point light, from a lamp fact or a built-in bank builder, wherever it sits under a furniture body) SHALL light the room grids: the first pass records the lamp-lit surfaces, the second carries them one bounce through doorways. Furniture renderables, shades and transmissive bodies included, SHALL stay out of the grid capture without hiding any lamp's ancestor; reflection probes SHALL keep capturing furniture.

#### Scenario: Nested lamp reaches the grid
- **WHEN** a room holds one fact lamp whose light is a child of a mesh body, a zero-specular grey card stands beyond the lamp's cutoff while lamp-lit shell lies in view of the room's grid probes, and the grid is baked once with the lamp at its authored intensity and once at zero, each a fresh bake
- **THEN** the card's linear reading is higher after the bake with the lamp on, by more than the recorded tolerance

#### Scenario: Transmissive body
- **WHEN** the same comparison is made with the lamp's light a child of a transmissive mesh body
- **THEN** the card's linear reading is higher with the lamp on, by more than the recorded tolerance

#### Scenario: Bank lamp reaches the grid
- **WHEN** the same comparison is made with a built-in bank floor lamp
- **THEN** the card's linear reading is higher with the bank lamp on

#### Scenario: Furniture out of the grid capture
- **WHEN** a grid is baked with a tall cabinet standing between a grid probe and a sunlit wall
- **THEN** the grid's readings equal those of a bake without the cabinet within the recorded tolerance

#### Scenario: Layers restored
- **WHEN** a grid bake slice ends, normally or by an error thrown inside it
- **THEN** every furniture renderable has the layer mask and visibility it had before the slice

#### Scenario: Shade still in the reflection
- **WHEN** the room probe of a room with a glowing shade is captured
- **THEN** the probe sees the shade, with its emissive term capped as on screen

### Requirement: Every lamp has one source room

In `walk` and `tour` each lamp SHALL belong to one source room: the room whose polygon contains its emitter's world position in plan, boundary included, the first such room in the room order when several do. A lamp outside every room polygon SHALL belong to no room and SHALL light no surface inside a room box; there SHALL be no nearest-room fallback. Every box of one room SHALL carry that room.

#### Scenario: Lamp in the living room
- **WHEN** a floor lamp's light stands inside the living room polygon
- **THEN** its source room is the living room

#### Scenario: Emitter on a shared boundary
- **WHEN** a light's plan position lies on the edge two room polygons share
- **THEN** its source room is the room listed first in the room order, on every load

#### Scenario: Lamp in no room
- **WHEN** a lamp's light stands outside every room polygon, also when only a few millimetres into the wall
- **THEN** it adds no light to any surface inside a room box in walk and no light to any grid, and it does not light the whole apartment

#### Scenario: Wall-mounted lamps of the supported library
- **WHEN** every supported wall-mounted lamp fact is placed against a wall of a room
- **THEN** its emitter lies inside that room's polygon and the room is its source room

### Requirement: Receiver room

Each lit fragment SHALL take the room of the boxes that contain its lookup point (the surface point pushed along its normal), boundary included; where boxes of several rooms contain it, the room the normal points into SHALL own it, and on an exact tie the lower room index. Each side of a door leaf or frame SHALL take the room it faces. Boxes SHALL NOT be widened across walls; a point outside every box SHALL have no room.

#### Scenario: Door jamb on the shared centreline
- **WHEN** a jamb face lies on the centreline two rooms share, its normal parallel to the boundary
- **THEN** it takes the lower-indexed room's lamps, in display and in a capture

#### Scenario: Door leaf
- **WHEN** a closed door leaf stands between rooms A and B, each holding a lamp
- **THEN** its face towards A takes only A's lamps and its face towards B only B's, in display and in a capture

#### Scenario: Window reveal
- **WHEN** a window reveal runs through the wall thickness of a room holding a lamp
- **THEN** the part inside the room's box takes the room's lamp and the part beyond every box takes none, in display and in a capture

#### Scenario: Furniture against a wall
- **WHEN** a cabinet stands against a wall shared with a lit neighbouring room
- **THEN** it takes only its own room's lamps, in display and in a capture

### Requirement: Lamp light stays in its room

In `walk`, `tour` and the grid and reflection captures made for them, a lamp's direct light (diffuse and specular) SHALL reach a surface only when the surface's receiver room is the lamp's source room; a surface with no room SHALL take no lamp light. Reflected light SHALL still pass openings. The editing modes SHALL be unchanged.

#### Scenario: Direct light rejected beyond a wall
- **WHEN** a lamp stands 0.5 m from a wall two rooms share, within its cutoff of a zero-specular card on the other side, and with one baked grid kept the lamp's intensity is set to its authored value and to zero
- **THEN** the far-side card's linear reading is the same in both within the recorded tolerance, while a card on the lamp's side differs

#### Scenario: Doorway
- **WHEN** room A's lamp lights A's wall facing a doorway to room B, and B holds no lamp
- **THEN** B's room probe and B's grid see A's lit wall through the doorway, while with B's grid kept B's floor beside the doorway reads the same with the lamp at its intensity and at zero

#### Scenario: Split room shows no seam
- **WHEN** a lamp lights the floor across the boundary between two boxes of one open-plan room
- **THEN** the lamp's direct light continues across the boundary with no step larger than between neighbouring pixels elsewhere

#### Scenario: Camera position does not matter
- **WHEN** a zero-specular card on room A's lamp-lit wall is read in walk from inside A and from inside B through a doorway
- **THEN** its linear reading is the same from both positions within the recorded tolerance

#### Scenario: Shared material in two rooms
- **WHEN** one material is used by a wall in room A and a wall in room B, and only A holds a lamp
- **THEN** A's wall takes the lamp's direct light and B's does not

#### Scenario: Warm-up
- **WHEN** walk is entered and the direct look is shown while the grids and probes bake
- **THEN** a lamp's direct light already stops at its room boundary

#### Scenario: Editing modes unchanged
- **WHEN** the viewer enters walk, the bake completes, and the viewer returns to orbit
- **THEN** an orbit frame is pixel-identical to one taken before entering walk, lamp light through walls included

### Requirement: Concave rooms

A concave room whose lamp's direct light is shown, in a supported scene (the demo apartment or a plan fixture), to cross the room's own inner wall SHALL be fixed by a demonstrated containment method with a measured cost. Without such a case, a lamp and a surface in one room SHALL be treated as seeing each other, and the README SHALL state that limit.

#### Scenario: Supported scenes audited
- **WHEN** every room with more than one box in the supported scenes is checked for a lamp whose cutoff reaches a surface behind the room's inner corner
- **THEN** either no such surface is visibly lit by that lamp and the README names the limit, or one is and, after the fix, that surface takes no direct light from the lamp while a surface in clear sight of it across a box split does

#### Scenario: Demo living room, measured
- **WHEN** the demo living room (an L around the hall) is metered in walk on a hardware renderer at the floor behind its inner corner, (4.1, 0, 4.0), with the pendant at (5.5, 1.66, 7.06) at its intensity and at zero, the grid kept
- **THEN** the displayed luminance differs by 3.9 % (0.0918 against 0.0883, measured when the lamp scope was delivered): no visible crossing, so the limit stands and the README names it

### Requirement: Lamp scope compiles nothing

The room gate SHALL use no room-specific shader variant: with the number and kinds of lights and their shadow layout unchanged, entering, leaving and crossing rooms, moving the camera, re-assigning a lamp's room and switching the gate on or off SHALL compile no program once the walk warm-up is done. A change in the light count MAY compile programs and SHALL render correctly.

#### Scenario: Walking through rooms
- **WHEN** after the walk bake the camera walks from one room to another and back over several frames
- **THEN** the number of compiled programs stays constant

#### Scenario: Lamp moved to another room
- **WHEN** after the warm-up (the first bake, the first return to the direct look and the first furniture edit in walk) a lamp is moved in walk into another room and the walk lighting has re-baked
- **THEN** no program is compiled

#### Scenario: Light count from none to several and back
- **WHEN** lamps are added in walk from none to one to several and removed back to none, the lighting re-baking after each
- **THEN** every state renders its expected lamp pixels, including after a nested render returns, and WebGL reports no error
