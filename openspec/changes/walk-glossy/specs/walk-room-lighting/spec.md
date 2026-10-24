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

Each room SHALL have one reflection probe point at 1.5 m above the floor, inside the room, at least 0.5 m in 3D from every furniture item's bounding box; among such points the one farthest from the room's edges SHALL be used. When none qualifies, the point with the largest clearance from furniture boxes and room edges SHALL be used. Equal candidates SHALL be decided the same way every time.

#### Scenario: Floor lamp in the middle of the room
- **WHEN** a floor lamp whose shade reaches the probe height stands at the centre of a room
- **THEN** the probe point is at least 0.5 m from the lamp's box

#### Scenario: Low furniture does not push the probe
- **WHEN** a sofa 0.8 m high stands at the centre of a room
- **THEN** the probe point is the same as in the empty room

#### Scenario: No point clears the furniture
- **WHEN** furniture leaves no point of a room 0.5 m clear
- **THEN** the probe point is the point with the largest clearance from furniture boxes and room edges, inside the room

#### Scenario: Deterministic
- **WHEN** the placement runs twice on the same rooms and furniture
- **THEN** it answers the same points

#### Scenario: Demo living room
- **WHEN** the demo apartment is loaded in walk
- **THEN** the living room's probe point is at least 0.5 m from the floor lamp's box, and the lamp's shade no longer fills the probe's upward view

### Requirement: Probe placement follows furniture edits

After a furniture edit in walk the probe points SHALL be recomputed from the current furniture; a room whose probe point changed SHALL be captured at its new point, and every room box of that room SHALL project its reflections from the new point.

#### Scenario: Lamp moved next to the probe
- **WHEN** a floor lamp is moved in walk to within 0.2 m of its room's probe point and the debounce passes
- **THEN** the room's probe is captured at a point at least 0.5 m from the lamp's new box, and every box of that room uses that point for its reflections

#### Scenario: Edit that does not change placement
- **WHEN** a piece of furniture is moved in walk and no room's probe point changes
- **THEN** only its room's probe is re-captured, at the same point

### Requirement: Glossy finishes read as glossy

In walk, a floor's reflection SHALL show its roughness in its contrast: inside a room, the specular contrast (99th percentile over median of the floor's specular, with its colour, normal and roughness maps off) of roughness 0.07 SHALL be at least 2.5 times that of roughness 0.6; where geometry puts the window's mirror image on the floor, a polished floor SHALL show the window.

#### Scenario: Contrast by roughness
- **WHEN** the demo living-room floor is metered in walk at roughness 0.07 and at 0.6, with the room lighting live
- **THEN** the 0.07 floor's specular contrast is at least 2.5 times the 0.6 floor's

#### Scenario: Window in a polished floor
- **WHEN** a pose sees the floor band where the living room window's mirror image falls, at roughness 0.07, with the room lighting live
- **THEN** that band is brighter than the floor beside it, in the window's screen column
