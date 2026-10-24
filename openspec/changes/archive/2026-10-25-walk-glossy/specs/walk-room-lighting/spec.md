# Spec Delta

## MODIFIED Requirements

### Requirement: Room reflection probes

In `walk` and `tour` glossy surfaces SHALL reflect their own room from a probe captured at the room's probe point (requirement «Reflection probe placement»), box-projected onto the room's box, blended with the neighbouring room within 0.4 m of a shared boundary. Probes SHALL be captured without feedback from earlier probes and without mirrors; a fragment outside every room box SHALL reflect the studio environment.

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
- **THEN** after the debounce its room's probe is re-captured, together with the probe of every other room whose probe point the move changed, and no other probe or grid; a finish change in a room re-bakes that room's grid and probe

#### Scenario: Capture during the bake
- **WHEN** a still is captured in walk before the bake is done
- **THEN** it shows the direct look

## ADDED Requirements

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
