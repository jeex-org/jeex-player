## REMOVED Requirements

### Requirement: Baked surfaces in walk and tour

**Reason**: The lightmap was scaled by the walk sun factor and captures saw it unscaled; it now carries the walk gain everywhere in walk, captures included.

**Migration**: replaced by «Baked surfaces under the walk lighting» below.

## ADDED Requirements

### Requirement: Baked surfaces under the walk lighting

In walk and tour a baked surface SHALL show its lightmap times the walk gain (`LIGHTING_STANDARD.baked.exposure.walk`) at the walk exposure, never scaled by the walk sun factor; its sun SHALL be scaled as on any surface, its reflections inside a room box SHALL come from the room probes. Outside every box the outside exposure compensation SHALL apply. Grid and probe captures SHALL see the lightmap times the walk gain.

#### Scenario: Baked room in walk
- **WHEN** a baked room is viewed in walk after the bake of grids and probes
- **THEN** its lightmap contribution is the editing contribution times the walk gain over the editing gain, and its glossy surfaces reflect the room probe

#### Scenario: Baked surface outside the rooms
- **WHEN** a baked surface outside every room box is read in walk and in an editing mode
- **THEN** its walk reading is its editing reading times the outside exposure compensation times the walk gain over the editing gain, and the exterior grid adds no diffuse light to it

#### Scenario: Lightmap with the walk gain in a grid capture
- **WHEN** a room grid is baked in walk with a baked surface in view of a grid probe
- **THEN** the probe sees the surface's lightmap times the walk gain, read back from the capture within the tolerance

#### Scenario: No shader change on entry
- **WHEN** the viewer enters walk with baked surfaces in view, the bake completes and the room lighting switches on
- **THEN** no program is compiled in the swap frame or after it; the first installation and the bake warm-up may compile
