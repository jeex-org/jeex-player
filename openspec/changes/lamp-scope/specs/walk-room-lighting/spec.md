# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Glossy finishes read as glossy

In walk by daylight (every lamp off, the lighting freshly baked), on the demo living-room fixture (recorded pose, resolution and floor mask), the floor's specular contrast (99th percentile over median of linear specular luminance, floor black, non-metal, map-free) at roughness 0.07 SHALL be at least 2.2 times that at 0.6, and that ratio SHALL be at least 1.15 times the one read with the probe at the footprint rule's point; where geometry puts the window's mirror image on that floor, it SHALL show the window.

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
- **THEN** the shade's mean brightest channel is at most 1.52 (the highest lamps-on reading measured when the lamps joined the room grids, 1.38, plus 10 %: the light a lamp bounces off the ceiling and walls lands on its own shade) and at least 1.25 times the same shade with its emissive off

#### Scenario: Editing glow unchanged
- **WHEN** the same shade is metered in orbit, `plan3d` and the editing look before and after a walk session
- **THEN** its readings are unchanged


### Requirement: Bake and refresh

On entry to `walk` or `tour` the grids and probes SHALL be built after the walk chain is ready, a fixed number of probes per frame, while the direct look is shown, then switched on in one frame without a recompile. Edits in walk SHALL refresh only what they affect after a short debounce; a scene load, a full rebuild, a sun change, a context restore, and a change that alters a lamp (moved, removed, added, variant swapped, retinted) SHALL re-bake everything, in walk or tour only. More than 16 room boxes SHALL keep the direct look and report an error.

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
