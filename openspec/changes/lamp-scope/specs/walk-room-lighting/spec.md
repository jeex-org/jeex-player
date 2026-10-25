# Spec Delta

## ADDED Requirements

### Requirement: Lamps feed the room grids

In `walk` and `tour` every lamp (every artificial point light, from a lamp fact or a built-in bank builder, wherever it sits under a furniture body) SHALL light the room grids: its first pass records the lamp-lit surfaces, its second carries them one bounce through doorways. Furniture bodies and shades SHALL stay out of the grid capture; reflection probes SHALL keep capturing furniture. A grid bake SHALL leave every object's layers and visibility as it found them.

#### Scenario: Nested lamp reaches the grid
- **WHEN** a room holds one fact lamp whose light is a child of a mesh body, and its grid is baked once with the lamp at its authored intensity and once at zero, each a fresh bake
- **THEN** a rough grey card in that room, out of the lamp's direct reach, reads brighter after the bake with the lamp on

#### Scenario: Bank lamp reaches the grid
- **WHEN** the same comparison is made with a built-in bank floor lamp
- **THEN** the card reads brighter with the bank lamp on

#### Scenario: Furniture out of the grid capture
- **WHEN** a grid is baked with a tall cabinet standing between a grid probe and a sunlit wall
- **THEN** the grid's readings equal those of a bake without the cabinet within the tolerance

#### Scenario: Layers restored
- **WHEN** a grid bake slice ends, normally or by an error thrown inside it
- **THEN** every furniture mesh has the layer mask and visibility it had before the slice

#### Scenario: Shade still in the reflection
- **WHEN** the room probe of a room with a glowing shade is captured
- **THEN** the probe sees the shade, with its emissive term capped as on screen

### Requirement: Every lamp has one source room

In `walk` and `tour` each lamp SHALL belong to one source room: the room whose polygon contains its emitter's world position in plan, the first such room in the room order when several do. A lamp outside every room polygon SHALL belong to no room and SHALL light no surface inside a room box. Every box of one room SHALL carry that room.

#### Scenario: Lamp in the living room
- **WHEN** a floor lamp's light stands inside the living room polygon
- **THEN** its source room is the living room

#### Scenario: Emitter on a shared boundary
- **WHEN** a light's plan position lies on the edge two room polygons share
- **THEN** its source room is the room listed first in the room order, on every load

#### Scenario: Lamp in no room
- **WHEN** a lamp's light stands outside every room polygon
- **THEN** it adds no light to any surface inside a room box in walk, and it does not light the whole apartment

#### Scenario: Wall sconce near the wall
- **WHEN** a light sits inside a room polygon within the wall margin the grid's sampling box leaves out
- **THEN** its source room is that room

### Requirement: Lamp light stays in its room

In `walk`, `tour` and the grid and reflection captures made for them, a lamp's direct light (diffuse and specular) SHALL reach a surface only when the surface's room, located per fragment like the room grids, is the lamp's source room; a surface outside every room box SHALL take no lamp light. Reflected light SHALL still pass openings. The editing modes SHALL be unchanged.

#### Scenario: Closed wall
- **WHEN** a lamp stands 0.5 m from a wall shared by two rooms with no opening near it, within its cutoff of the other side
- **THEN** a grey card on the other side reads the same with the lamp on and at zero intensity, each after a fresh bake, while a card on the lamp's side is lit

#### Scenario: Doorway
- **WHEN** room A's lamp lights A's wall facing a doorway to room B, and B holds no lamp
- **THEN** B's room probe and B's grid see A's lit wall through the doorway, while B's floor beside the doorway takes no direct light from A's lamp

#### Scenario: Split room shows no seam
- **WHEN** a lamp lights the floor across the boundary between two boxes of one open-plan room
- **THEN** the lamp's direct light continues across the boundary with no step larger than between neighbouring pixels elsewhere

#### Scenario: Camera position does not matter
- **WHEN** room A's lamp-lit wall is viewed in walk from inside A and from inside B through a doorway
- **THEN** the wall's lamp contribution is the same within the tolerance from both positions

#### Scenario: Shared material in two rooms
- **WHEN** one material is used by a wall in room A and a wall in room B, and only A holds a lamp
- **THEN** A's wall takes the lamp's light and B's does not

#### Scenario: Warm-up
- **WHEN** walk is entered and the direct look is shown while the grids and probes bake
- **THEN** a lamp's direct light already stops at its room boundary

#### Scenario: Editing modes unchanged
- **WHEN** the viewer enters walk, the bake completes, and the viewer returns to orbit
- **THEN** an orbit frame is pixel-identical to one taken before entering walk, lamp light through walls included

### Requirement: Concave rooms

A lamp and a surface in one room SHALL be treated as seeing each other, also in a concave room whose inner wall corner lies between them; the README SHALL state this limit, unless a segment test confined to multi-box rooms is delivered because a supported scene shows such a leak.

#### Scenario: L-shaped room
- **WHEN** a lamp stands in one arm of an L-shaped room and a surface in the other arm, behind the inner corner, lies within its cutoff
- **THEN** the README names this case as a known limit, or, where the segment test is delivered, the surface takes no direct light from the lamp while a surface in clear sight of it across a box split does

### Requirement: Lamp scope compiles nothing

The room gate SHALL use no room-specific shader variant: entering, leaving and crossing rooms, moving the camera, re-assigning a lamp's room and switching the gate on or off SHALL compile no program once the walk warm-up is done and the number and kinds of lights stay the same.

#### Scenario: Walking through rooms
- **WHEN** after the walk bake the camera walks from one room to another and back over several frames
- **THEN** the number of compiled programs stays constant

#### Scenario: Lamp moved to another room
- **WHEN** a lamp is moved in walk into another room and the walk lighting has re-baked
- **THEN** no program is compiled beyond those of the first warm-up

## MODIFIED Requirements

### Requirement: Bake and refresh

On entry to `walk` or `tour` the grids and probes SHALL be built after the walk chain is ready, a fixed number of probes per frame, while the direct look is shown, then switched on in one frame without a recompile. Edits in walk SHALL refresh only what they affect after a short debounce; a scene load, a full rebuild, a sun change, a context restore, and a change that affects a lamp (moved, removed, added, variant swapped, the light temperature) SHALL re-bake everything. More than 16 room boxes SHALL keep the direct look and report an error.

#### Scenario: No shader thrash
- **WHEN** the lighting has switched on in walk
- **THEN** the number of compiled programs stays constant over the following 10 frames

#### Scenario: Edit in walk
- **WHEN** a piece of furniture without a lamp light is moved in walk
- **THEN** after the debounce its room's probe is re-captured, together with the probe of every other room whose probe point the move changed, and no other probe or grid; a finish change in a room re-bakes that room's grid and probe

#### Scenario: Lamp moved in walk
- **WHEN** a lamp is moved in walk from one room to another and the debounce passes
- **THEN** every grid and then every probe is baked again, the lamp's light no longer brightens its old room's grid, and it lights only its new room directly

#### Scenario: Lamp removed or swapped in walk
- **WHEN** a lamp is removed, or swapped to a variant with another light, in walk
- **THEN** after the debounce every grid and probe is baked again and no light of the old lamp remains in any grid

#### Scenario: Temperature in walk
- **WHEN** the light temperature changes in walk and the value rests
- **THEN** every grid and then every probe is baked again with the tinted lamps

#### Scenario: Capture during the bake
- **WHEN** a still is captured in walk before the bake is done
- **THEN** it shows the direct look
