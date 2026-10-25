# Spec Delta

## MODIFIED Requirements

### Requirement: Lamp classification follows three's light order

Which lamp is baked, and which source room each drawn point light belongs to (capability `walk-room-lighting`), SHALL be resolved per drawn light for every render, including captures and renders nested inside another render, whatever the mix of shadow-casting lights, lights with a projected texture, hidden ancestors and camera layers.

#### Scenario: Mixed ordering
- **WHEN** baked and live spot lights are mixed with and without shadows and projected textures
- **THEN** each light's diffuse on a baked surface is dropped exactly when it is marked baked

#### Scenario: Hidden ancestor and camera layer
- **WHEN** a live lamp's parent is hidden, or a lamp is on a layer the camera does not see, beside a baked lamp
- **THEN** the remaining lamps keep their own classification

#### Scenario: Nested render
- **WHEN** a render draws another scene or camera in the middle of its own draw and then continues
- **THEN** both renders apply the classification of their own lights

#### Scenario: Rooms follow the order
- **WHEN** in walk two point lights of different rooms are drawn, one of them casting a shadow so three lists it first, and the other's parent hidden in a capture
- **THEN** each light still lights only its own room's surfaces, and the remaining one keeps its room when the other is hidden

#### Scenario: Lamp under a mesh hidden from the capture
- **WHEN** a grid capture leaves a lamp's mesh body out by its layers
- **THEN** the lamp is drawn in that capture with its own source room

### Requirement: No recompile once warmed up

Marking a material baked SHALL compile it once; the first entry into walk, the grid and probe bake and the first return to an editing mode (where hidden grids change three's own program parameters) MAY compile programs. Once that warm-up is done, the swap frame, later switches between modes, marking a lamp baked or live, changing its intensity, and changing its source room SHALL compile no new program while the number and kinds of lights stay the same.

#### Scenario: Toggle a lamp after warm-up
- **WHEN** after the walk bake has completed a lamp is switched between baked and live and its intensity changed over several frames, with no light added or removed
- **THEN** the number of compiled programs stays constant

#### Scenario: Mode switches after warm-up
- **WHEN** after the warm-up the viewer switches from walk to an editing mode and back
- **THEN** the number of compiled programs stays constant

#### Scenario: Room of a lamp changes after warm-up
- **WHEN** after the warm-up a lamp's source room is changed and the walk lighting re-bakes
- **THEN** the number of compiled programs stays constant
